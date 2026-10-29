import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  Share,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { StatusBar as ExpoStatusBar } from "expo-status-bar";
import { cardLabel } from "./src/engine/cards";
import {
  canDeclare,
  createMatch,
  currentPlayer,
  declareRound,
  discardCards,
  drawCard,
  finalLeaderboard,
  handValue,
  nextRound
} from "./src/engine/gameEngine";
import { playUntilHumanTurn } from "./src/engine/ai";

const SAVE_KEY = "declare.savedMatch.v1";
const USER_KEY = "declare.user.v1";
const BACKEND_KEY = "declare.backendUrl.v1";
// Set EXPO_PUBLIC_API_URL at build time (for example https://declare-api.onrender.com).
// Without it, players type the server URL on the login screen.
const DEFAULT_BACKEND_URL = process.env.EXPO_PUBLIC_API_URL || "";
const REQUEST_TIMEOUT_MS = 15000;
const PING_INTERVAL_MS = 25000;
const MAX_RECONNECT_ATTEMPTS = 6;

const baseSetup = {
  numberOfPlayers: 4,
  playerTypes: ["human", "ai", "ai", "ai", "ai", "ai"],
  playerNames: ["You", "Mira", "Dev", "Kavya", "Noah", "Ira"],
  difficulties: ["medium", "medium", "medium", "hard", "easy", "medium"]
};

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// Every server call goes through here so timeouts, network failures, and non-JSON
// responses all produce a readable message instead of a raw parser error.
async function apiRequest(baseUrl, path, { method = "GET", token, body } = {}) {
  if (!baseUrl) throw new ApiError("Enter the server URL first.", 0);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
  } catch (error) {
    const message = error?.name === "AbortError"
      ? "The server took too long to respond. Check the server URL and try again."
      : "Could not reach the server. Check the server URL and your internet connection.";
    throw new ApiError(message, 0);
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = {};
    }
  }
  if (!response.ok) throw new ApiError(errorMessage(data, response.status), response.status);
  return data;
}

function errorMessage(data, status) {
  if (typeof data.detail === "string") return data.detail;
  if (Array.isArray(data.detail)) return data.detail.map((item) => item.msg).join(" ");
  if (status === 404) return "That server address did not respond like a Declare server. Check the server URL.";
  if (status === 429) return "Too many requests. Wait a moment and try again.";
  return `The server returned an error (${status}). Try again.`;
}

function isValidServerUrl(url) {
  return /^https?:\/\/[^\s/]+/i.test(url);
}

// Only an unfinished local match can be resumed. Finished matches and online matches are never offered.
function resumableMatch(raw) {
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw);
    return saved && saved.mode !== "online" && saved.status !== "matchResult" ? saved : null;
  } catch {
    return null;
  }
}

function parseStoredSession(raw) {
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw);
    return saved.user && saved.token ? saved : null;
  } catch {
    return null;
  }
}

export default function App() {
  const [screen, setScreen] = useState("welcome");
  const [setup, setSetup] = useState(baseSetup);
  const [match, setMatch] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [settings, setSettings] = useState({ darkMode: true, largeCards: false });
  const [scoreboardOpen, setScoreboardOpen] = useState(false);
  const [savedAvailable, setSavedAvailable] = useState(false);
  const [onlineRoom, setOnlineRoom] = useState(null);
  const [authUser, setAuthUser] = useState(null);
  const [authToken, setAuthToken] = useState(null);
  const [backendUrl, setBackendUrl] = useState(DEFAULT_BACKEND_URL);
  const [onlineStatus, setOnlineStatus] = useState("");
  const roomSocketRef = useRef(null);
  const roomCodeRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const pingTimerRef = useRef(null);

  // Each account keeps its own unfinished local match. Guests share one slot on this device.
  const savedKey = authUser ? `${SAVE_KEY}.${authUser.id}` : SAVE_KEY;
  const theme = useMemo(() => makeTheme(settings.darkMode), [settings.darkMode]);
  const styles = useMemo(() => createStyles(theme, settings.largeCards), [theme, settings.largeCards]);

  useEffect(() => {
    AsyncStorage.getItem(savedKey).then((value) => {
      const saved = resumableMatch(value);
      setSavedAvailable(Boolean(saved));
      if (value && !saved) AsyncStorage.removeItem(savedKey);
    });
  }, [savedKey]);

  useEffect(() => {
    AsyncStorage.getItem(BACKEND_KEY).then((value) => {
      if (value) setBackendUrl(value);
    });
    restoreSession();
    return () => closeRoomSocket();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!match || match.mode === "online") return;
    if (match.status === "matchResult") {
      AsyncStorage.removeItem(savedKey).then(() => setSavedAvailable(false));
      return;
    }
    AsyncStorage.setItem(savedKey, JSON.stringify(match)).then(() => setSavedAvailable(true));
  }, [match, savedKey]);

  useEffect(() => {
    if (!match || screen !== "gameplay" || match.status !== "playing") return undefined;
    if (currentPlayer(match).type !== "ai") return undefined;
    const timer = setTimeout(() => {
      setSelectedIds([]);
      setMatch((previous) => {
        const next = playUntilHumanTurn(previous);
        if (next.status === "roundResult") setScreen("roundResult");
        if (next.status === "matchResult") setScreen("matchResult");
        return next;
      });
    }, 650);
    return () => clearTimeout(timer);
  }, [match, screen]);

  function startMatch() {
    const players = Array.from({ length: setup.numberOfPlayers }, (_, index) => ({
      id: `p${index + 1}`,
      name: setup.playerNames[index] || `Player ${index + 1}`,
      type: setup.playerTypes[index],
      difficulty: setup.difficulties[index]
    }));
    const created = playUntilHumanTurn(createMatch({ players, darkMode: settings.darkMode }));
    setMatch(created);
    setSelectedIds([]);
    setScreen("gameplay");
  }

  async function rememberServerUrl(value) {
    const url = normalizeBackendUrl(value);
    if (!isValidServerUrl(url)) {
      throw new ApiError("Enter a server URL that starts with https:// (or http:// on your local network).", 0);
    }
    setBackendUrl(url);
    await AsyncStorage.setItem(BACKEND_KEY, url);
    return url;
  }

  async function saveSession(session) {
    setMatch(null);
    setAuthUser(session.user);
    setAuthToken(session.token);
    await AsyncStorage.setItem(USER_KEY, JSON.stringify({ user: session.user, token: session.token }));
  }

  async function clearSession() {
    closeRoomSocket();
    setAuthUser(null);
    setAuthToken(null);
    setOnlineRoom(null);
    setOnlineStatus("");
    setMatch(null);
    await AsyncStorage.removeItem(USER_KEY);
  }

  // On launch, check the saved token with the server. Only a rejected token signs the player out;
  // a network failure keeps the session so the player can try again later.
  async function restoreSession() {
    const [rawSession, savedUrl] = await Promise.all([AsyncStorage.getItem(USER_KEY), AsyncStorage.getItem(BACKEND_KEY)]);
    const saved = parseStoredSession(rawSession);
    if (!saved) return;
    setAuthUser(saved.user);
    setAuthToken(saved.token);
    setScreen("home");
    try {
      const user = await apiRequest(normalizeBackendUrl(savedUrl || DEFAULT_BACKEND_URL), "/auth/me", { token: saved.token });
      await saveSession({ user, token: saved.token });
    } catch (error) {
      if (error.status === 401) await clearSession();
    }
  }

  async function loginOnline({ email, password, username, mode, verificationCode }) {
    const baseUrl = await rememberServerUrl(backendUrl);
    const path = mode === "signup" ? "/auth/signup" : mode === "verify" ? "/auth/verify-email" : mode === "reset" ? "/auth/reset-password" : "/auth/login";
    const body = mode === "verify" ? { email, code: verificationCode } : mode === "reset" ? { email, code: verificationCode, password } : { email, password, username };
    const result = await apiRequest(baseUrl, path, { method: "POST", body });
    if (result.requires_verification) return result;
    await saveSession(result);
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
      // Signing out locally matters more than the server call, so ignore failures here.
      apiRequest(url, "/auth/logout", { method: "POST", token: authToken }).catch(() => {});
    }
    await clearSession();
    setScreen("home");
  }

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
      // Ignore close events from sockets we already replaced or closed on purpose.
      if (roomSocketRef.current !== socket) return;
      clearInterval(pingTimerRef.current);
      roomSocketRef.current = null;
      if (!roomCodeRef.current) return;
      // 1000: the server closed this socket on purpose (for example after leaving the room).
      if (event.code === 1000) {
        roomCodeRef.current = null;
        setOnlineStatus("Disconnected from room.");
        return;
      }
      if (event.code === 1008) {
        roomCodeRef.current = null;
        setOnlineStatus("You are no longer in this room. Rejoin with the room code.");
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
      if (event.type === "Pong") return;
      if (event.type === "Snapshot") {
        setOnlineRoom(event.payload.room);
        if (event.payload.match) {
          setMatch(event.payload.match);
          setScreen(event.payload.match.status === "playing" ? "gameplay" : event.payload.match.status);
        }
      }
      if (event.type === "RoomJoined" && event.payload.room) {
        setOnlineRoom(event.payload.room);
      }
      if (event.type === "RoomLeft" && event.payload.room) {
        setOnlineRoom(event.payload.room);
      }
      if ((event.type === "GameStarted" || event.type === "GameStateSynced") && event.payload.match) {
        setMatch(event.payload.match);
        setSelectedIds([]);
        setScreen(event.payload.match.status === "playing" ? "gameplay" : event.payload.match.status);
      }
      if (event.payload?.error) Alert.alert("Move blocked", event.payload.error);
    };
  }

  function sendOnlineAction(type, payload = {}) {
    if (!roomSocketRef.current || roomSocketRef.current.readyState !== WebSocket.OPEN || !onlineRoom) {
      Alert.alert("Not connected", "Reconnecting to the room. Try again in a moment.");
      return;
    }
    roomSocketRef.current.send(JSON.stringify({
      type,
      payload
    }));
  }

  function startOnlineMatch() {
    if (!onlineRoom) return;
    sendOnlineAction("GameStarted");
  }

  async function leaveRoom() {
    if (!onlineRoom) return;
    try {
      await apiRequest(normalizeBackendUrl(backendUrl), `/rooms/${onlineRoom.code}/leave`, { method: "POST", token: authToken });
    } catch (error) {
      Alert.alert("Could not leave the room", error.message);
      return;
    }
    closeRoomSocket();
    if (match?.mode === "online") setMatch(null);
    setOnlineRoom(null);
    setOnlineStatus("You left the room.");
  }

  async function resumeMatch() {
    const parsed = resumableMatch(await AsyncStorage.getItem(savedKey));
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
      if (match?.mode === "online") return;
      const next = action(match);
      setMatch(next);
      setSelectedIds([]);
      if (next.status === "roundResult") setScreen("roundResult");
      if (next.status === "matchResult") setScreen("matchResult");
    } catch (error) {
      Alert.alert("Move blocked", error.message);
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

  const content = {
    home: (
      <HomeScreen
        styles={styles}
        savedAvailable={savedAvailable}
        onNewGame={() => setScreen("setup")}
        onResume={resumeMatch}
        onStatistics={() => setScreen("statistics")}
        onSettings={() => setScreen("settings")}
        onOnline={() => setScreen("online")}
        user={authUser}
        onLogin={() => setScreen("login")}
        onLogout={logoutOnline}
      />
    ),
    setup: <SetupScreen styles={styles} setup={setup} setSetup={setSetup} onBack={() => setScreen("home")} onStart={startMatch} />,
    welcome: <WelcomeScreen styles={styles} onLogin={() => setScreen("login")} onPlayWithoutAccount={() => setScreen("home")} />,
    login: <LoginScreen styles={styles} backendUrl={backendUrl} setBackendUrl={setBackendUrl} onLogin={loginOnline} onResendVerification={resendVerification} onForgotPassword={forgotPassword} onBack={() => setScreen("welcome")} />,
    gameplay: match && (
      <GameplayScreen
        styles={styles}
        match={match}
        localPlayerId={match.mode === "online" ? authUser?.id : null}
        selectedIds={selectedIds}
        onSelectCard={selectCard}
        onDraw={(source) => match.mode === "online" ? sendOnlineAction("CardDrawn", { source }) : updateMatchWith((state) => drawCard(state, currentPlayer(state).id, source))}
        onDiscard={() => match.mode === "online" ? sendOnlineAction("CardsDiscarded", { cardIds: selectedIds }) : updateMatchWith((state) => discardCards(state, currentPlayer(state).id, selectedIds))}
        onDeclare={() => match.mode === "online" ? sendOnlineAction("DeclareAttempted") : updateMatchWith((state) => declareRound(state, currentPlayer(state).id))}
        onMenu={() => setScreen("home")}
      />
    ),
    roundResult: match && (
      <RoundResultScreen
        styles={styles}
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
    ),
    matchResult: match && <MatchResultScreen styles={styles} match={match} onPlayAgain={startMatch} onNewMatch={() => setScreen("setup")} onExit={() => setScreen("home")} />,
    statistics: <StatisticsScreen styles={styles} match={match} onBack={() => setScreen("home")} />,
    settings: <SettingsScreen styles={styles} settings={settings} setSettings={setSettings} onBack={() => setScreen("home")} />,
    online: authUser && authToken ? (
      <OnlineScreen
        styles={styles}
        user={authUser}
        authToken={authToken}
        backendUrl={backendUrl}
        setBackendUrl={setBackendUrl}
        room={onlineRoom}
        setRoom={setOnlineRoom}
        status={onlineStatus}
        onBack={() => setScreen("home")}
        onConnectRoom={connectRoomSocket}
        onStartMatch={startOnlineMatch}
        onLeaveRoom={leaveRoom}
        onSessionExpired={clearSession}
        onLogout={logoutOnline}
      />
    ) : (
      <LoginScreen styles={styles} backendUrl={backendUrl} setBackendUrl={setBackendUrl} onLogin={loginOnline} onResendVerification={resendVerification} onForgotPassword={forgotPassword} onBack={() => setScreen("welcome")} />
    )
  }[screen];

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle={settings.darkMode ? "light-content" : "dark-content"} />
      <ExpoStatusBar style={settings.darkMode ? "light" : "dark"} />
      {content}
      <ScoreboardModal styles={styles} visible={scoreboardOpen} match={match} onClose={() => setScoreboardOpen(false)} />
    </SafeAreaView>
  );
}

function WelcomeScreen({ styles, onLogin, onPlayWithoutAccount }) {
  return (
    <Screen styles={styles}>
      <View style={styles.hero}>
        <Text style={styles.kicker}>DECLARE</Text>
        <Text style={styles.title}>Lowest hand wins.</Text>
        <Text style={styles.muted}>Sign in to play online with friends, or play on this device without an account.</Text>
      </View>
      <PrimaryButton styles={styles} label="Login or Sign Up" onPress={onLogin} />
      <SecondaryButton styles={styles} label="Play without account" onPress={onPlayWithoutAccount} />
    </Screen>
  );
}

function HomeScreen({ styles, savedAvailable, onNewGame, onResume, onStatistics, onSettings, onOnline, user, onLogin, onLogout }) {
  return (
    <Screen styles={styles}>
      <View style={styles.hero}>
        <Text style={styles.kicker}>DECLARE</Text>
        <Text style={styles.title}>Lowest hand wins.</Text>
        <Text style={styles.muted}>{user ? `Signed in as ${user.username}` : "Sign in to play online."}</Text>
      </View>
      <PrimaryButton styles={styles} label="New Game" onPress={onNewGame} />
      {savedAvailable ? <PrimaryButton styles={styles} label="Resume Match" onPress={onResume} /> : null}
      {user ? <PrimaryButton styles={styles} label="Online Game" onPress={onOnline} /> : <PrimaryButton styles={styles} label="Login" onPress={onLogin} />}
      {user ? <SecondaryButton styles={styles} label="Log out" onPress={onLogout} /> : null}
      <View style={styles.row}>
        <SecondaryButton styles={styles} label="Statistics" onPress={onStatistics} />
        <SecondaryButton styles={styles} label="Settings" onPress={onSettings} />
      </View>
    </Screen>
  );
}

function LoginScreen({ styles, backendUrl, setBackendUrl, onLogin, onResendVerification, onForgotPassword, onBack }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [verificationCode, setVerificationCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit() {
    const cleanEmail = email.trim();
    if (!cleanEmail || (mode !== "verify" && !password)) {
      setMessage("Email and password are required.");
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) {
      setMessage("Enter a valid email address.");
      return;
    }
    if (mode === "signup" && password.length < 15) {
      setMessage("Use a password or passphrase with at least 15 characters.");
      return;
    }
    if ((mode === "verify" || mode === "reset") && !/^\d{6}$/.test(verificationCode)) {
      setMessage("Enter the six-digit code from your email.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const result = await onLogin({ email: cleanEmail, password, username: username.trim(), mode, verificationCode });
      if (result?.requires_verification) {
        setMode("verify");
        setMessage(result.development_code ? `${result.message}\nDevelopment code: ${result.development_code}` : result.message);
      }
    } catch (error) {
      // The server rejects sign-in until the email is verified. Take the player to the code step.
      if (error.status === 403 && mode === "login") {
        setMode("verify");
        setMessage("Your email is not verified yet. Enter the code we sent, or request a new one.");
      } else {
        setMessage(error.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function forgot() {
    if (!email) {
      setMessage("Enter your email first.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const result = await onForgotPassword(email);
      setMode("reset");
      setMessage(result.development_code ? `${result.message}\nDevelopment code: ${result.development_code}` : result.message);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (!email) {
      setMessage("Enter your email first.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const result = await onResendVerification(email);
      setMessage(result.development_code ? `${result.message}\nDevelopment code: ${result.development_code}` : result.message);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen styles={styles}>
      <View style={styles.hero}>
        <Text style={styles.kicker}>DECLARE</Text>
        <Text style={styles.title}>{mode === "verify" ? "Verify email" : mode === "reset" ? "Reset password" : "Play together."}</Text>
      </View>
      {mode !== "verify" && mode !== "reset" && <View style={styles.segmentRow}>
        <Pressable style={[styles.smallSegment, mode === "login" && styles.segmentActive]} onPress={() => { setMode("login"); setMessage(""); }}>
          <Text style={styles.segmentText}>Login</Text>
        </Pressable>
        <Pressable style={[styles.smallSegment, mode === "signup" && styles.segmentActive]} onPress={() => { setMode("signup"); setMessage(""); }}>
          <Text style={styles.segmentText}>Sign Up</Text>
        </Pressable>
      </View>}
      <View style={styles.playerEditor}>
        <Text style={styles.label}>Backend URL</Text>
        <TextInput style={styles.input} value={backendUrl} autoCapitalize="none" placeholder="http://YOUR-PC-IP:8000" placeholderTextColor={styles.placeholder.color} onChangeText={setBackendUrl} />
        {mode === "signup" && (
          <>
            <Text style={styles.label}>Username</Text>
            <TextInput style={styles.input} value={username} autoCapitalize="words" placeholder="Your player name" placeholderTextColor={styles.placeholder.color} onChangeText={setUsername} />
          </>
        )}
        <Text style={styles.label}>Email</Text>
        <TextInput style={styles.input} value={email} keyboardType="email-address" autoCapitalize="none" placeholder="you@example.com" placeholderTextColor={styles.placeholder.color} onChangeText={setEmail} />
        {mode === "verify" ? (
          <>
            <Text style={styles.label}>Verification code</Text>
            <TextInput style={styles.input} value={verificationCode} keyboardType="number-pad" maxLength={6} placeholder="6-digit code" placeholderTextColor={styles.placeholder.color} onChangeText={setVerificationCode} />
          </>
        ) : (
          <>
            <Text style={styles.label}>Password</Text>
            <View style={styles.passwordRow}>
              <TextInput style={[styles.input, styles.passwordInput]} value={password} secureTextEntry={!showPassword} placeholder="Password or passphrase" placeholderTextColor={styles.placeholder.color} onChangeText={setPassword} />
              <SecondaryButton styles={styles} label={showPassword ? "Hide" : "Show"} onPress={() => setShowPassword(!showPassword)} compact />
            </View>
            {(mode === "signup" || mode === "reset") && <Text style={styles.muted}>Use 15 to 128 characters. Common passwords are blocked; spaces and symbols are allowed.</Text>}
            {mode === "reset" && <>
              <Text style={styles.label}>Reset code</Text>
              <TextInput style={styles.input} value={verificationCode} keyboardType="number-pad" maxLength={6} placeholder="6-digit code" placeholderTextColor={styles.placeholder.color} onChangeText={setVerificationCode} />
            </>}
          </>
        )}
        {message ? <Text style={styles.statusText}>{message}</Text> : null}
      </View>
      <PrimaryButton styles={styles} label={mode === "login" ? "Login" : mode === "signup" ? "Create Account" : mode === "verify" ? "Verify Email" : "Reset Password"} disabled={busy} onPress={submit} />
      {mode === "verify" ? <SecondaryButton styles={styles} label="Resend Code" onPress={resend} /> : mode === "reset" ? <SecondaryButton styles={styles} label="Request Another Code" onPress={forgot} /> : <SecondaryButton styles={styles} label="Forgot Password" onPress={forgot} />}
      {(mode === "verify" || mode === "reset") && <SecondaryButton styles={styles} label="Back to login" onPress={() => { setMode("login"); setMessage(""); }} />}
      {(mode === "login" || mode === "signup") && <SecondaryButton styles={styles} label="Back" onPress={onBack} />}
    </Screen>
  );
}

function SetupScreen({ styles, setup, setSetup, onBack, onStart }) {
  const indexes = Array.from({ length: setup.numberOfPlayers }, (_, index) => index);
  return (
    <Screen styles={styles}>
      <TopBar styles={styles} title="Setup" onBack={onBack} />
      <Text style={styles.label}>Players</Text>
      <View style={styles.segmentRow}>
        {[2, 3, 4, 5, 6].map((count) => (
          <Pressable key={count} style={[styles.segment, setup.numberOfPlayers === count && styles.segmentActive]} onPress={() => setSetup({ ...setup, numberOfPlayers: count })}>
            <Text style={styles.segmentText}>{count}</Text>
          </Pressable>
        ))}
      </View>
      {indexes.map((index) => (
        <View key={index} style={styles.playerEditor}>
          <TextInput
            style={styles.input}
            value={setup.playerNames[index]}
            placeholder={`Player ${index + 1}`}
            placeholderTextColor={styles.placeholder.color}
            onChangeText={(text) => {
              const playerNames = [...setup.playerNames];
              playerNames[index] = text;
              setSetup({ ...setup, playerNames });
            }}
          />
          <View style={styles.row}>
            {["human", "ai"].map((type) => (
              <Pressable
                key={type}
                style={[styles.smallSegment, setup.playerTypes[index] === type && styles.segmentActive]}
                onPress={() => {
                  const playerTypes = [...setup.playerTypes];
                  playerTypes[index] = type;
                  setSetup({ ...setup, playerTypes });
                }}
              >
                <Text style={styles.segmentText}>{type === "human" ? "Human" : "AI"}</Text>
              </Pressable>
            ))}
          </View>
          {setup.playerTypes[index] === "ai" && (
            <View style={styles.row}>
              {["easy", "medium", "hard"].map((difficulty) => (
                <Pressable
                  key={difficulty}
                  style={[styles.tinySegment, setup.difficulties[index] === difficulty && styles.segmentActive]}
                  onPress={() => {
                    const difficulties = [...setup.difficulties];
                    difficulties[index] = difficulty;
                    setSetup({ ...setup, difficulties });
                  }}
                >
                  <Text style={styles.segmentText}>{capitalize(difficulty)}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      ))}
      <PrimaryButton styles={styles} label="Start Match" onPress={onStart} />
    </Screen>
  );
}

function GameplayScreen({ styles, match, localPlayerId, selectedIds, onSelectCard, onDraw, onDiscard, onDeclare, onMenu }) {
  const player = currentPlayer(match);
  const isHuman = player.type === "human";
  // Show only cards the viewer may see. During an AI turn on this device, the hand stays hidden.
  const hand = localPlayerId ? match.hands[localPlayerId] || [] : isHuman ? match.hands[player.id] || [] : [];
  const canInteract = isHuman && (!localPlayerId || player.id === localPlayerId);
  const discarded = match.turn.hasDiscarded;
  const drawn = match.turn.hasDrawn;
  const declareReady = canDeclare(match, player.id);
  const canDrawFromDrawPile = match.drawPile.length > 0 || match.discardPile.length > 1;
  // Before discarding, the pile shows its top card. After discarding, it shows the card that can be picked up.
  const pickupCard = discarded
    ? match.discardPile.find((card) => card.id === match.turn.pickupCardId)
    : match.discardPile[match.discardPile.length - 1];
  const stepHint = !canInteract
    ? ""
    : !discarded
      ? "Step 1: select cards of one rank and discard them."
      : "Step 2: pick up the card from the discard pile or draw one from the draw pile.";

  return (
    <Screen styles={styles}>
      <TopBar styles={styles} title={`Round ${match.roundNumber}`} onBack={onMenu} />
      <View style={styles.statusBand}>
        <Text style={styles.statusTitle}>{player.name}'s turn</Text>
        <Text style={styles.statusText}>{canInteract ? `Hand value ${handValue(hand)}` : `${player.name} is playing`}</Text>
      </View>
      <ScoreboardPanel styles={styles} match={match} />
      <View style={styles.piles}>
        <Pile styles={styles} label="Draw" count={match.drawPile.length || "Mix"} onPress={() => onDraw("draw")} disabled={!canInteract || !discarded || drawn || !canDrawFromDrawPile} />
        <Pile
          styles={styles}
          label="Discard"
          count={match.discardPile.length}
          top={pickupCard}
          onPress={() => onDraw("discard")}
          disabled={!canInteract || !discarded || drawn || !pickupCard}
        />
      </View>
      <Text style={styles.label}>{localPlayerId ? "Your hand" : "Hand"}</Text>
      <View style={styles.handGrid}>
        {hand.map((card) => (
          <CardButton key={card.id} styles={styles} card={card} selected={selectedIds.includes(card.id)} onPress={() => onSelectCard(card)} disabled={!canInteract} />
        ))}
      </View>
      {stepHint ? <Text style={styles.statusText}>{stepHint}</Text> : null}
      <View style={styles.actionBar}>
        <PrimaryButton styles={styles} label="Declare" disabled={!canInteract || !declareReady} onPress={onDeclare} />
        <PrimaryButton styles={styles} label="Discard" disabled={!canInteract || discarded || selectedIds.length === 0} onPress={onDiscard} />
      </View>
    </Screen>
  );
}

function RoundResultScreen({ styles, match, onContinue, onMenu }) {
  const result = match.roundResult;
  return (
    <Screen styles={styles}>
      <TopBar styles={styles} title="Round Result" onBack={onMenu} />
      <ResultBanner styles={styles} type={result.declareResult.type} declarer={playerName(match, result.declarerId)} />
      {match.players.map((player) => (
        <View key={player.id} style={styles.resultRow}>
          <View style={styles.resultHeader}>
            <Text style={styles.resultName}>{player.name}</Text>
            <Text style={styles.resultScore}>{formatDelta(result.declareResult.roundScores[player.id])} / {player.totalScore}</Text>
          </View>
          <Text style={styles.muted}>{match.hands[player.id].map(cardLabel).join("  ")} - value {result.handValues[player.id]}</Text>
        </View>
      ))}
      <PrimaryButton styles={styles} label="Next Round" onPress={onContinue} />
    </Screen>
  );
}

function MatchResultScreen({ styles, match, onPlayAgain, onNewMatch, onExit }) {
  const leaderboard = finalLeaderboard(match);
  return (
    <Screen styles={styles}>
      <Text style={styles.kicker}>WINNER</Text>
      <Text style={styles.title}>{leaderboard[0].name}</Text>
      {leaderboard.map((player, index) => (
        <View key={player.id} style={styles.leaderRow}>
          <Text style={styles.resultName}>{index + 1}. {player.name}</Text>
          <Text style={styles.resultScore}>{player.totalScore}</Text>
        </View>
      ))}
      <View style={styles.statsGrid}>
        <Stat styles={styles} label="Rounds" value={match.matchStats.roundsPlayed} />
        <Stat styles={styles} label="Success" value={match.matchStats.successfulDeclares} />
        <Stat styles={styles} label="Failed" value={match.matchStats.failedDeclares} />
        <Stat styles={styles} label="Special" value={match.matchStats.specialDeclares} />
      </View>
      <PrimaryButton styles={styles} label="Play Again" onPress={onPlayAgain} />
      <View style={styles.row}>
        <SecondaryButton styles={styles} label="New Match" onPress={onNewMatch} />
        <SecondaryButton styles={styles} label="Exit" onPress={onExit} />
      </View>
    </Screen>
  );
}

function StatisticsScreen({ styles, match, onBack }) {
  return (
    <Screen styles={styles}>
      <TopBar styles={styles} title="Statistics" onBack={onBack} />
      {match ? (
        <>
          <View style={styles.statsGrid}>
            <Stat styles={styles} label="Rounds" value={match.matchStats.roundsPlayed} />
            <Stat styles={styles} label="Success" value={match.matchStats.successfulDeclares} />
            <Stat styles={styles} label="Failed" value={match.matchStats.failedDeclares} />
            <Stat styles={styles} label="Special" value={match.matchStats.specialDeclares} />
          </View>
          {match.players.map((player) => (
            <View key={player.id} style={styles.leaderRow}>
              <Text style={styles.resultName}>{player.name}</Text>
              <Text style={styles.resultScore}>{player.totalScore}</Text>
            </View>
          ))}
        </>
      ) : (
        <Text style={styles.muted}>No match data yet.</Text>
      )}
    </Screen>
  );
}

function SettingsScreen({ styles, settings, setSettings, onBack }) {
  return (
    <Screen styles={styles}>
      <TopBar styles={styles} title="Settings" onBack={onBack} />
      <SettingRow styles={styles} label="Dark mode" value={settings.darkMode} onValueChange={(darkMode) => setSettings({ ...settings, darkMode })} />
      <SettingRow styles={styles} label="Large cards" value={settings.largeCards} onValueChange={(largeCards) => setSettings({ ...settings, largeCards })} />
    </Screen>
  );
}

function OnlineScreen({ styles, user, authToken, backendUrl, setBackendUrl, room, setRoom, status, onBack, onConnectRoom, onStartMatch, onLeaveRoom, onSessionExpired, onLogout }) {
  const [joinCode, setJoinCode] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  // Shared failure handling: a rejected token means the session ended, so return to login.
  function handleFailure(error) {
    if (error.status === 401) {
      Alert.alert("Signed out", error.message);
      onSessionExpired();
      return;
    }
    setMessage(error.message);
  }

  async function createRoom() {
    setBusy(true);
    setMessage("");
    try {
      const body = await apiRequest(normalizeBackendUrl(backendUrl), "/rooms", {
        method: "POST",
        token: authToken,
        body: {
          host: onlinePlayer(user),
          settings: { max_players: maxPlayers, public: false, ai_fill_empty_seats: false, turn_timer_seconds: 45, spectators_enabled: false }
        }
      });
      setRoom(body);
      onConnectRoom(body.code);
    } catch (error) {
      handleFailure(error);
    } finally {
      setBusy(false);
    }
  }

  async function joinRoom() {
    const code = joinCode.trim().toUpperCase();
    if (!code) {
      setMessage("Enter a room code.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const body = await apiRequest(normalizeBackendUrl(backendUrl), `/rooms/${encodeURIComponent(code)}/join`, {
        method: "POST",
        token: authToken,
        body: { player: onlinePlayer(user) }
      });
      setRoom(body);
      setJoinCode("");
      onConnectRoom(body.code);
    } catch (error) {
      handleFailure(error);
    } finally {
      setBusy(false);
    }
  }

  function shareRoom() {
    Share.share({ message: `Join my Declare game. Room code: ${room.code}` }).catch(() => {});
  }

  const isHost = room?.host_id === user.id;

  return (
    <Screen styles={styles}>
      <TopBar styles={styles} title="Online Game" onBack={onBack} />
      <View style={styles.statusBand}>
        <Text style={styles.statusTitle}>Signed in as {user.username}</Text>
        <Text style={styles.statusText}>{status || "Ready for remote play."}</Text>
      </View>
      <View style={styles.playerEditor}>
        <Text style={styles.label}>Backend URL</Text>
        <TextInput style={styles.input} value={backendUrl} autoCapitalize="none" placeholder="http://YOUR-PC-IP:8000" placeholderTextColor={styles.placeholder.color} onChangeText={setBackendUrl} />
        <Text style={styles.label}>Room size</Text>
        <View style={styles.segmentRow}>
          {[2, 3, 4, 5, 6].map((count) => (
            <Pressable key={count} style={[styles.segment, maxPlayers === count && styles.segmentActive]} onPress={() => setMaxPlayers(count)}>
              <Text style={styles.segmentText}>{count}</Text>
            </Pressable>
          ))}
        </View>
        <PrimaryButton styles={styles} label="Create Room" disabled={busy} onPress={createRoom} />
      </View>
      <View style={styles.playerEditor}>
        <Text style={styles.label}>Join Room Code</Text>
        <TextInput style={styles.input} value={joinCode} autoCapitalize="characters" placeholder="AB12CD" placeholderTextColor={styles.placeholder.color} onChangeText={setJoinCode} />
        <PrimaryButton styles={styles} label="Join Room" disabled={busy} onPress={joinRoom} />
      </View>
      {message ? <Text style={styles.statusText}>{message}</Text> : null}
      {room && (
        <View style={styles.statusBand}>
          <Text style={styles.statusTitle}>Room {room.code}</Text>
          <Text style={styles.statusText}>Share this code with your friends.</Text>
          <View style={styles.scoreboardPanel}>
            {room.players.map((player) => (
              <View key={player.id} style={styles.scorecardRow}>
                <Text style={styles.resultName}>{player.username}</Text>
                <Text style={styles.resultScore}>{player.id === room.host_id ? "Host" : "Joined"}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.statusText}>ROOM CODE: {room.code}</Text>
          <PrimaryButton styles={styles} label="Start Remote Match" disabled={!isHost || room.players.length < 2} onPress={onStartMatch} />
          <View style={styles.row}>
            <SecondaryButton styles={styles} label="Share Code" onPress={shareRoom} />
            <SecondaryButton styles={styles} label="Leave Room" onPress={onLeaveRoom} />
          </View>
        </View>
      )}
      <SecondaryButton styles={styles} label="Logout" onPress={onLogout} />
    </Screen>
  );
}

function ScoreboardModal({ styles, visible, match, onClose }) {
  if (!match) return null;
  return (
    <Modal transparent visible={visible} animationType="fade">
      <View style={styles.modalShade}>
        <View style={styles.modalPanel}>
          <Text style={styles.heading}>Scorecard</Text>
          {finalLeaderboard(match).map((player) => (
            <View key={player.id} style={styles.leaderRow}>
              <Text style={styles.resultName}>{player.name}</Text>
              <Text style={styles.resultScore}>{player.totalScore}</Text>
            </View>
          ))}
          <PrimaryButton styles={styles} label="Close" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

function ScoreboardPanel({ styles, match }) {
  return (
    <View style={styles.scoreboardPanel}>
      <Text style={styles.label}>Scorecard</Text>
      {finalLeaderboard(match).map((player) => (
        <View key={player.id} style={styles.scorecardRow}>
          <Text style={styles.resultName}>{player.name}</Text>
          <Text style={styles.resultScore}>{player.totalScore}</Text>
        </View>
      ))}
    </View>
  );
}

function Screen({ styles, children }) {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent}>
      {children}
    </ScrollView>
  );
}

function TopBar({ styles, title, onBack, rightLabel, onRight }) {
  return (
    <View style={styles.topBar}>
      <SecondaryButton styles={styles} label="Back" onPress={onBack} compact />
      <Text style={styles.heading}>{title}</Text>
      {rightLabel ? <SecondaryButton styles={styles} label={rightLabel} onPress={onRight} compact /> : <View style={styles.topSpacer} />}
    </View>
  );
}

function PrimaryButton({ styles, label, onPress, disabled }) {
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.button, disabled && styles.disabled]}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

function SecondaryButton({ styles, label, onPress, compact }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.secondaryButton, compact && styles.compactButton]}>
      <Text style={styles.secondaryText}>{label}</Text>
    </Pressable>
  );
}

function CardButton({ styles, card, selected, onPress, disabled }) {
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.card, selected && styles.cardSelected]}>
      <Text style={styles.cardRank}>{card.rank}</Text>
      <Text style={styles.cardSuit}>{card.suit[0].toUpperCase()}</Text>
    </Pressable>
  );
}

function Pile({ styles, label, count, top, onPress, disabled }) {
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.pile, disabled && styles.disabled]}>
      <Text style={styles.pileLabel}>{label}</Text>
      <Text style={styles.pileTop}>{top ? cardLabel(top) : count}</Text>
    </Pressable>
  );
}

function SettingRow({ styles, label, value, onValueChange }) {
  return (
    <View style={styles.settingRow}>
      <Text style={styles.resultName}>{label}</Text>
      <Switch value={value} onValueChange={onValueChange} />
    </View>
  );
}

function Stat({ styles, label, value }) {
  return (
    <View style={styles.statBox}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.muted}>{label}</Text>
    </View>
  );
}

function ResultBanner({ styles, type, declarer }) {
  const copy = {
    success: "Successful Declare",
    failed: "Failed Declare",
    tie: "Tie Declare",
    "same-card-bonus": "Same Card Bonus"
  }[type];
  return (
    <View style={styles.statusBand}>
      <Text style={styles.statusTitle}>{copy}</Text>
      <Text style={styles.statusText}>{declarer}</Text>
    </View>
  );
}

function playerName(match, id) {
  return match.players.find((player) => player.id === id)?.name || id;
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatDelta(value) {
  return value > 0 ? `+${value}` : String(value);
}

function normalizeBackendUrl(url) {
  return (url || DEFAULT_BACKEND_URL).trim().replace(/\/+$/, "");
}

function httpToWs(url) {
  const normalized = normalizeBackendUrl(url);
  if (normalized.startsWith("https://")) return normalized.replace("https://", "wss://");
  return normalized.replace("http://", "ws://");
}

function onlinePlayer(user) {
  return {
    id: user.id,
    username: user.username,
    avatar: null,
    ready: false
  };
}

function makeTheme(dark) {
  return dark
    ? {
        bg: "#0f172a",
        panel: "#182235",
        raised: "#22314a",
        text: "#f8fafc",
        muted: "#a8b3c7",
        accent: "#2dd4bf",
        accentText: "#05231f",
        border: "#334155",
        danger: "#fb7185"
      }
    : {
        bg: "#f7f7f2",
        panel: "#ffffff",
        raised: "#e8efe9",
        text: "#17201c",
        muted: "#5f6f67",
        accent: "#0f9f82",
        accentText: "#ffffff",
        border: "#cbd5cf",
        danger: "#be123c"
      };
}

function createStyles(theme, largeCards) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: theme.bg },
    screen: { flex: 1, backgroundColor: theme.bg },
    screenContent: { padding: 20, gap: 14, paddingBottom: 40 },
    hero: { minHeight: 170, justifyContent: "flex-end", paddingVertical: 20 },
    kicker: { color: theme.accent, fontSize: 16, fontWeight: "800", letterSpacing: 0 },
    title: { color: theme.text, fontSize: 42, lineHeight: 48, fontWeight: "900", letterSpacing: 0 },
    heading: { color: theme.text, fontSize: 22, fontWeight: "800", letterSpacing: 0 },
    label: { color: theme.muted, fontSize: 14, fontWeight: "700", marginTop: 8 },
    muted: { color: theme.muted, fontSize: 14, letterSpacing: 0 },
    placeholder: { color: theme.muted },
    button: { minHeight: 52, borderRadius: 8, backgroundColor: theme.accent, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
    buttonText: { color: theme.accentText, fontWeight: "900", fontSize: 16, letterSpacing: 0 },
    secondaryButton: { minHeight: 48, flex: 1, borderRadius: 8, backgroundColor: theme.raised, alignItems: "center", justifyContent: "center", paddingHorizontal: 14 },
    compactButton: { minHeight: 40, flex: 0, minWidth: 78 },
    secondaryText: { color: theme.text, fontWeight: "800", letterSpacing: 0 },
    disabled: { opacity: 0.45 },
    row: { flexDirection: "row", gap: 10, alignItems: "center" },
    topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
    topSpacer: { width: 78 },
    segmentRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
    segment: { width: 48, height: 42, borderRadius: 8, backgroundColor: theme.raised, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: theme.border },
    smallSegment: { flex: 1, height: 40, borderRadius: 8, backgroundColor: theme.raised, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: theme.border },
    tinySegment: { flex: 1, height: 36, borderRadius: 8, backgroundColor: theme.raised, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: theme.border },
    segmentActive: { backgroundColor: theme.accent, borderColor: theme.accent },
    segmentText: { color: theme.text, fontWeight: "800", letterSpacing: 0 },
    playerEditor: { gap: 8, padding: 12, backgroundColor: theme.panel, borderRadius: 8, borderWidth: 1, borderColor: theme.border },
    input: { minHeight: 44, borderRadius: 8, backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border, color: theme.text, paddingHorizontal: 12, fontWeight: "700" },
    passwordRow: { flexDirection: "row", gap: 8, alignItems: "center" },
    passwordInput: { flex: 1 },
    statusBand: { gap: 6, padding: 14, backgroundColor: theme.panel, borderRadius: 8, borderWidth: 1, borderColor: theme.border },
    statusTitle: { color: theme.text, fontSize: 20, fontWeight: "900", letterSpacing: 0 },
    statusText: { color: theme.muted, fontSize: 15, fontWeight: "700", letterSpacing: 0 },
    piles: { flexDirection: "row", gap: 12 },
    pile: { flex: 1, minHeight: 112, borderRadius: 8, backgroundColor: theme.raised, borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center", gap: 8 },
    pileLabel: { color: theme.muted, fontWeight: "800" },
    pileTop: { color: theme.text, fontSize: 28, fontWeight: "900", letterSpacing: 0 },
    handGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    card: { width: largeCards ? 72 : 58, height: largeCards ? 102 : 84, borderRadius: 8, backgroundColor: theme.panel, borderWidth: 2, borderColor: theme.border, padding: 8, justifyContent: "space-between" },
    cardSelected: { borderColor: theme.accent, transform: [{ translateY: -6 }], backgroundColor: theme.raised },
    cardRank: { color: theme.text, fontSize: largeCards ? 24 : 20, fontWeight: "900", letterSpacing: 0 },
    cardSuit: { color: theme.danger, fontSize: 16, fontWeight: "900", alignSelf: "flex-end", letterSpacing: 0 },
    actionBar: { gap: 10, marginTop: 8 },
    scoreboardPanel: { gap: 8, padding: 12, backgroundColor: theme.panel, borderRadius: 8, borderWidth: 1, borderColor: theme.border },
    scorecardRow: { minHeight: 34, flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderBottomWidth: 1, borderBottomColor: theme.border },
    resultRow: { gap: 6, padding: 12, backgroundColor: theme.panel, borderRadius: 8, borderWidth: 1, borderColor: theme.border },
    resultHeader: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
    resultName: { color: theme.text, fontSize: 16, fontWeight: "800", letterSpacing: 0 },
    resultScore: { color: theme.accent, fontSize: 16, fontWeight: "900", letterSpacing: 0 },
    leaderRow: { minHeight: 48, flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 12, borderRadius: 8, backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.border },
    statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    statBox: { width: "47%", minHeight: 88, borderRadius: 8, backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" },
    statValue: { color: theme.text, fontSize: 28, fontWeight: "900", letterSpacing: 0 },
    settingRow: { minHeight: 56, flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 12, backgroundColor: theme.panel, borderRadius: 8, borderWidth: 1, borderColor: theme.border },
    modalShade: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", padding: 20 },
    modalPanel: { width: "100%", maxWidth: 420, gap: 12, borderRadius: 8, padding: 16, backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border }
  });
}
