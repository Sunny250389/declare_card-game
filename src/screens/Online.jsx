import { useState } from "react";
import { apiRequest, normalizeBackendUrl } from "../api.js";
import { Field, PrimaryButton, Screen, SecondaryButton, Segment, TopBar } from "../components/ui.jsx";
import { onlinePlayer } from "../format.js";

export function OnlineScreen({ user, authToken, backendUrl, setBackendUrl, room, setRoom, status, onBack, onConnectRoom, onStartMatch, onLeaveRoom, onSessionExpired, onLogout, notify }) {
  const [joinCode, setJoinCode] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const isHost = room?.host_id === user.id;

  // A rejected session means the player must sign in again.
  function handleFailure(error) {
    if (error.status === 401) {
      notify(error.message);
      onSessionExpired();
      return;
    }
    setMessage(error.message);
  }

  async function withBusy(action) {
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (error) {
      handleFailure(error);
    } finally {
      setBusy(false);
    }
  }

  function createRoom() {
    withBusy(async () => {
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
    });
  }

  function joinRoom() {
    const code = joinCode.trim().toUpperCase();
    if (!code) {
      setMessage("Enter a room code.");
      return;
    }
    withBusy(async () => {
      const body = await apiRequest(normalizeBackendUrl(backendUrl), `/rooms/${encodeURIComponent(code)}/join`, {
        method: "POST",
        token: authToken,
        body: { player: onlinePlayer(user) }
      });
      setRoom(body);
      setJoinCode("");
      onConnectRoom(body.code);
    });
  }

  async function shareRoom() {
    const text = `Join my Declare game. Room code: ${room.code}`;
    try {
      if (navigator.share) {
        await navigator.share({ text });
      } else {
        await navigator.clipboard.writeText(text);
        notify("Room code copied.");
      }
    } catch {
      // The player cancelled the share sheet. Nothing to do.
    }
  }

  return (
    <Screen>
      <TopBar title="Online Game" onBack={onBack} />
      <section className="band">
        <p className="band-title">Signed in as {user.username}</p>
        <p className="band-text">{status || "Ready for remote play."}</p>
      </section>
      <div className="panel">
        <Field label="Server URL">
          <input className="input" value={backendUrl} autoCapitalize="none" placeholder="http://192.168.0.111:8000" onChange={(event) => setBackendUrl(event.target.value)} />
        </Field>
        <p className="label">Room size</p>
        <div className="segment-row">
          {[2, 3, 4, 5, 6].map((count) => (
            <Segment key={count} label={String(count)} active={maxPlayers === count} onClick={() => setMaxPlayers(count)} />
          ))}
        </div>
        <PrimaryButton label="Create Room" disabled={busy} onClick={createRoom} />
      </div>
      <div className="panel">
        <Field label="Join room code">
          <input className="input" value={joinCode} autoCapitalize="characters" placeholder="AB12CD" onChange={(event) => setJoinCode(event.target.value)} />
        </Field>
        <PrimaryButton label="Join Room" disabled={busy} onClick={joinRoom} />
      </div>
      {message && <p className="status-text">{message}</p>}
      {room && (
        <section className="band">
          <p className="band-title">Room {room.code}</p>
          <p className="band-text">Share this code with your friends.</p>
          <div className="panel">
            {room.players.map((player) => (
              <div key={player.id} className="score-row">
                <span className="result-name">{player.username}</span>
                <span className="result-score">{player.id === room.host_id ? "Host" : "Joined"}</span>
              </div>
            ))}
          </div>
          <PrimaryButton label="Start Remote Match" disabled={!isHost || room.players.length < 2} onClick={onStartMatch} />
          <div className="row">
            <SecondaryButton label="Share Code" onClick={shareRoom} />
            <SecondaryButton label="Leave Room" onClick={onLeaveRoom} />
          </div>
        </section>
      )}
      <SecondaryButton label="Logout" onClick={onLogout} />
    </Screen>
  );
}
