import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, apiRequest, defaultServerUrl, httpToWs, isValidServerUrl, normalizeBackendUrl } from "./api.js";
import { playUntilHumanTurn } from "./engine/ai.js";
import { canDeclare, createMatch, currentPlayer, declareRound, discardCards, drawCard, nextRound } from "./engine/gameEngine.js";
import { Toast } from "./components/ui.jsx";
import { WelcomeScreen } from "./screens/Welcome.jsx";
import { LoginScreen } from "./screens/Login.jsx";
import { HomeScreen } from "./screens/Home.jsx";
import { SetupScreen } from "./screens/Setup.jsx";
import { GameplayScreen } from "./screens/Gameplay.jsx";
import { MatchResultScreen, RoundResultScreen } from "./screens/Results.jsx";
import { SettingsScreen, StatisticsScreen } from "./screens/Settings.jsx";
import { OnlineScreen } from "./screens/Online.jsx";
import { BACKEND_KEY, USER_KEY, parseStoredSession, readItem, removeItem, resumableMatch, savedMatchKey, writeItem } from "./storage.js";

const PING_INTERVAL_MS = 25000;
const MAX_RECONNECT_ATTEMPTS = 6;
const AI_DELAY_MS = 650;

const baseSetup = {
  numberOfPlayers: 4,
  playerTypes: ["human", "ai", "ai", "ai", "ai", "ai"],
  playerNames: ["You", "Mira", "Dev", "Kavya", "Noah", "Ira"],
  difficulties: ["medium", "medium", "medium", "hard", "easy", "medium"]
};

export default function App() {
  const [screen, setScreen] = useState("welcome");
  const [setup, setSetup] = useState(baseSetup);
  const [match, setMatch] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [settings, setSettings] = useState({ darkMode: true, largeCards: false });
  const [savedAvailable, setSavedAvailable] = useState(false);
  const [onlineRoom, setOnlineRoom] = useState(null);
  const [authUser, setAuthUser] = useState(null);
  const [authToken, setAuthToken] = useState(null);
  const [backendUrl, setBackendUrl] = useState(() => defaultServerUrl());
  const [onlineStatus, setOnlineStatus] = useState("");
  const [notice, setNotice] = useState(null);
  const roomSocketRef = useRef(null);
  const roomCodeRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const pingTimerRef = useRef(null);
  const savedKey = savedMatchKey(authUser?.id);

  const notify = useCallback((text) => setNotice({ text, id: Date.now() }), []);
  const dismissNotice = useCallback(() => setNotice(null), []);

  useEffect(() => {
    const savedUrl = readItem(BACKEND_KEY);
    if (savedUrl) setBackendUrl(savedUrl);
    restoreSession();
    return () => closeRoomSocket();
  }, []);

  // Keep the resume option in step with the current account's saved match.
  useEffect(() => {
    const raw = readItem(savedKey);
    const saved = resumableMatch(raw);
    if (raw && !saved) removeItem(savedKey);
    setSavedAvailable(Boolean(saved));
  }, [savedKey]);

  useEffect(() => {
    if (!match || match.mode === "online") return;
    if (match.status === "matchResult") {
      removeItem(savedKey);
      setSavedAvailable(false);
      return;
    }
    writeItem(savedKey, JSON.stringify(match));
    setSavedAvailable(true);
  }, [match, savedKey]);

  // AI players take their turns after a short pause, so the table is readable.
  useEffect(() => {
    if (!match || screen !== "gameplay" || match.status !== "playing") return undefined;
    if (currentPlayer(match).type !== "ai") return undefined;
    const timer = setTimeout(() => {
      const next = playUntilHumanTurn(match);
      setSelectedIds([]);
      setMatch(next);
      if (next.status !== "playing") setScreen(next.status);
    }, AI_DELAY_MS);
    return () => clearTimeout(timer);
  }, [match, screen]);

  function startMatch() {
    const players = Array.from({ length: setup.numberOfPlayers }, (_, index) => ({
      id: `p${index + 1}`,
      name: setup.playerNames[index] || `Player ${index + 1}`,
      type: setup.playerTypes[index],
      difficulty: setup.difficulties[index]
    }));
    setMatch(playUntilHumanTurn(createMatch({ players, darkMode: settings.darkMode })));
    setSelectedIds([]);
    setScreen("gameplay");
  }

  function resumeMatch() {
    const parsed = resumableMatch(readItem(savedKey));
    if (!parsed) {
      setSavedAvailable(false);
      return;
    }
    setMatch(parsed);
    setSelectedIds([]);
    setScreen(parsed.status === "roundResult" ? "roundResult" : "gameplay");
  }

  function updateMatchWith(action) {
    try {
      const next = action(match);
      setMatch(next);
      setSelectedIds([]);
      if (next.status !== "playing") setScreen(next.status);
    } catch (error) {
      notify(error.message);
    }
  }

  function selectCard(card) {
    if (!match || currentPlayer(match).type !== "human") return;
    const hand = match.hands[currentPlayer(match).id];
    const selectedCards = selectedIds.map((id) => hand.find((item) => item.id === id)).filter(Boolean);
    if (selectedCards.length > 0 && selectedCards[0].rank !== card.rank && !selectedIds.includes(card.id)) {
      setSelectedIds([card.id]);
      return;
    }
    setSelectedIds((ids) => (ids.includes(card.id) ? ids.filter((id) => id !== card.id) : [...ids, card.id]));
  }

  // ---- Accounts ----------------------------------------------------------

  function rememberServerUrl(value) {
    const url = normalizeBackendUrl(value);
    if (!isValidServerUrl(url)) {
      throw new ApiError("Enter a server URL that starts with http:// or https://.", 0);
    }
    setBackendUrl(url);
    writeItem(BACKEND_KEY, url);
    return url;
  }

  function saveSession(session) {
    setMatch(null);
    setAuthUser(session.user);
    setAuthToken(session.token);
    writeItem(USER_KEY, JSON.stringify({ user: session.user, token: session.token }));
  }

  function clearSession() {
    closeRoomSocket();
    setAuthUser(null);
    setAuthToken(null);
    setOnlineRoom(null);
    setOnlineStatus("");
    setMatch(null);
    removeItem(USER_KEY);
  }

  // On launch, check the saved token with the server. Only a rejected token signs the player out;
  // a network failure keeps the session so the player can try again later.
  async function restoreSession() {
    const saved = parseStoredSession(readItem(USER_KEY));
    if (!saved) return;
    setAuthUser(saved.user);
    setAuthToken(saved.token);
    setScreen("home");
    try {
      const user = await apiRequest(normalizeBackendUrl(readItem(BACKEND_KEY), defaultServerUrl()), "/auth/me", { token: saved.token });
      saveSession({ user, token: saved.token });
    } catch (error) {
      if (error.status === 401) clearSession();
    }
  }

  async function loginOnline({ email, password, username, mode, verificationCode }) {
    const baseUrl = rememberServerUrl(backendUrl);
    const path = mode === "signup" ? "/auth/signup" : mode === "verify" ? "/auth/verify-email" : mode === "reset" ? "/auth/reset-password" : "/auth/login";
    const body = mode === "verify" ? { email, code: verificationCode } : mode === "reset" ? { email, code: verificationCode, password } : { email, password, username };
    const result = await apiRequest(baseUrl, path, { method: "POST", body });
    if (result.requires_verification) return result;
    saveSession(result);
    setScreen("home");
    return result;
  }

  function resendVerification(email) {
    return apiRequest(normalizeBackendUrl(backendUrl), "/auth/resend-verification", { method: "POST", body: { email } });
  }

  function forgotPassword(email) {
    return apiRequest(normalizeBackendUrl(backendUrl), "/auth/forgot-password", { method: "POST", body: { email } });
  }

  async function logoutOnline() {
    const url = normalizeBackendUrl(backendUrl);
    if (authToken && isValidServerUrl(url)) {
      // Signing out on this device matters more than the server call, so ignore failures.
      apiRequest(url, "/auth/logout", { method: "POST", token: authToken }).catch(() => {});
    }
    clearSession();
    setScreen("home");
  }

  // ---- Online rooms ------------------------------------------------------

  function closeRoomSocket() {
    clearTimeout(reconnectTimerRef.current);
    clearInterval(pingTimerRef.current);
    reconnectTimerRef.current = null;
    pingTimerRef.current = null;
    roomCodeRef.current = null;
    const socket = roomSocketRef.current;
    roomSocketRef.current = null;
    if (socket) socket.close();
  }

  function connectRoomSocket(roomCode) {
    closeRoomSocket();
    roomCodeRef.current = roomCode;
    openRoomSocket(roomCode, 0);
  }

  function applyMatch(nextMatch) {
    setMatch(nextMatch);
    setSelectedIds([]);
    setScreen(nextMatch.status === "playing" ? "gameplay" : nextMatch.status);
  }

  function handleSocketEvent(event) {
    if (event.type === "Pong") return;
    if (event.type === "Snapshot") {
      setOnlineRoom(event.payload.room);
      if (event.payload.match) applyMatch(event.payload.match);
      return;
    }
    if ((event.type === "RoomJoined" || event.type === "RoomLeft") && event.payload.room) {
      setOnlineRoom(event.payload.room);
    }
    if ((event.type === "GameStarted" || event.type === "GameStateSynced") && event.payload.match) {
      applyMatch(event.payload.match);
    }
    if (event.payload?.error) notify(`Move blocked: ${event.payload.error}`);
  }

  function openRoomSocket(roomCode, attempt) {
    const socket = new WebSocket(`${httpToWs(normalizeBackendUrl(backendUrl))}/ws/rooms/${roomCode}?token=${encodeURIComponent(authToken || "")}`);
    roomSocketRef.current = socket;
    socket.onopen = () => {
      setOnlineStatus("Connected to room.");
      clearInterval(pingTimerRef.current);
      pingTimerRef.current = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "Ping", payload: {} }));
      }, PING_INTERVAL_MS);
    };
    socket.onerror = () => setOnlineStatus("Connection problem. Retrying...");
    socket.onclose = (event) => {
      // Ignore close events from sockets that were already replaced or closed on purpose.
      if (roomSocketRef.current !== socket) return;
      clearInterval(pingTimerRef.current);
      roomSocketRef.current = null;
      if (!roomCodeRef.current) return;
      // 1000: the server closed the socket on purpose, for example after leaving the room.
      // 1008: the server refused the socket, so this player is no longer in the room.
      if (event.code === 1000 || event.code === 1008) {
        roomCodeRef.current = null;
        setOnlineStatus(event.code === 1008 ? "You are no longer in this room. Rejoin with the room code." : "Disconnected from room.");
        return;
      }
      if (attempt >= MAX_RECONNECT_ATTEMPTS) {
        roomCodeRef.current = null;
        setOnlineStatus("Disconnected from room. Rejoin with the room code.");
        return;
      }
      setOnlineStatus("Connection lost. Reconnecting...");
      reconnectTimerRef.current = setTimeout(() => openRoomSocket(roomCode, attempt + 1), Math.min(1500 * (attempt + 1), 8000));
    };
    socket.onmessage = (message) => {
      let event;
      try {
        event = JSON.parse(message.data);
      } catch {
        return;
      }
      handleSocketEvent(event);
    };
  }

  function sendOnlineAction(type, payload = {}) {
    const socket = roomSocketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || !onlineRoom) {
      notify("Not connected. Reconnecting to the room. Try again in a moment.");
      return;
    }
    socket.send(JSON.stringify({ type, payload }));
  }

  async function leaveRoom() {
    if (!onlineRoom) return;
    try {
      await apiRequest(normalizeBackendUrl(backendUrl), `/rooms/${onlineRoom.code}/leave`, { method: "POST", token: authToken });
    } catch (error) {
      notify(error.message);
      return;
    }
    closeRoomSocket();
    if (match?.mode === "online") setMatch(null);
    setOnlineRoom(null);
    setOnlineStatus("You left the room.");
  }

  // ---- Screens -----------------------------------------------------------

  const isLocal = match && match.mode !== "online";
  const localPlayerId = match?.mode === "online" ? authUser?.id : null;

  function renderScreen() {
    switch (screen) {
      case "welcome":
        return <WelcomeScreen onLogin={() => setScreen("login")} onPlayWithoutAccount={() => setScreen("home")} />;
      case "login":
        return (
          <LoginScreen
            backendUrl={backendUrl}
            setBackendUrl={setBackendUrl}
            onLogin={loginOnline}
            onResendVerification={resendVerification}
            onForgotPassword={forgotPassword}
            onBack={() => setScreen("welcome")}
          />
        );
      case "home":
        return (
          <HomeScreen
            savedAvailable={savedAvailable}
            user={authUser}
            onNewGame={() => setScreen("setup")}
            onResume={resumeMatch}
            onStatistics={() => setScreen("statistics")}
            onSettings={() => setScreen("settings")}
            onOnline={() => setScreen("online")}
            onLogin={() => setScreen("login")}
            onLogout={logoutOnline}
          />
        );
      case "setup":
        return <SetupScreen setup={setup} setSetup={setSetup} onBack={() => setScreen("home")} onStart={startMatch} />;
      case "gameplay":
        return match && (
          <GameplayScreen
            match={match}
            localPlayerId={localPlayerId}
            selectedIds={selectedIds}
            onSelectCard={selectCard}
            onDraw={(source) => (match.mode === "online" ? sendOnlineAction("CardDrawn", { source }) : updateMatchWith((state) => drawCard(state, currentPlayer(state).id, source)))}
            onDiscard={() => (match.mode === "online" ? sendOnlineAction("CardsDiscarded", { cardIds: selectedIds }) : updateMatchWith((state) => discardCards(state, currentPlayer(state).id, selectedIds)))}
            onDeclare={() => (match.mode === "online" ? sendOnlineAction("DeclareAttempted") : updateMatchWith((state) => declareRound(state, currentPlayer(state).id)))}
            onMenu={() => setScreen("home")}
          />
        );
      case "roundResult":
        return match && (
          <RoundResultScreen
            match={match}
            onContinue={() => {
              if (match.mode === "online") {
                sendOnlineAction("RoundFinished");
                return;
              }
              const next = playUntilHumanTurn(nextRound(match));
              setMatch(next);
              setScreen(next.status === "playing" ? "gameplay" : next.status);
            }}
            onMenu={() => setScreen("home")}
          />
        );
      case "matchResult":
        return match && (
          <MatchResultScreen match={match} onPlayAgain={startMatch} onNewMatch={() => setScreen("setup")} onExit={() => setScreen("home")} />
        );
      case "statistics":
        return <StatisticsScreen match={isLocal ? match : null} onBack={() => setScreen("home")} />;
      case "settings":
        return <SettingsScreen settings={settings} setSettings={setSettings} onBack={() => setScreen("home")} />;
      case "online":
        return authUser && authToken ? (
          <OnlineScreen
            user={authUser}
            authToken={authToken}
            backendUrl={backendUrl}
            setBackendUrl={setBackendUrl}
            room={onlineRoom}
            setRoom={setOnlineRoom}
            status={onlineStatus}
            onBack={() => setScreen("home")}
            onConnectRoom={connectRoomSocket}
            onStartMatch={() => onlineRoom && sendOnlineAction("GameStarted")}
            onLeaveRoom={leaveRoom}
            onSessionExpired={clearSession}
            onLogout={logoutOnline}
            notify={notify}
          />
        ) : (
          <LoginScreen
            backendUrl={backendUrl}
            setBackendUrl={setBackendUrl}
            onLogin={loginOnline}
            onResendVerification={resendVerification}
            onForgotPassword={forgotPassword}
            onBack={() => setScreen("home")}
          />
        );
      default:
        return null;
    }
  }

  return (
    <div className={`app${settings.largeCards ? " large-cards" : ""}`} data-theme={settings.darkMode ? "dark" : "light"}>
      {renderScreen()}
      <Toast notice={notice} onDismiss={dismissNotice} />
    </div>
  );
}
