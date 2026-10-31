import { PrimaryButton, Screen, SecondaryButton } from "../components/ui.jsx";

export function HomeScreen({ savedAvailable, user, onNewGame, onResume, onStatistics, onSettings, onOnline, onLogin, onLogout }) {
  return (
    <Screen>
      <div className="hero">
        <p className="kicker">DECLARE</p>
        <h1 className="title">Lowest hand wins.</h1>
        <p className="muted">{user ? `Signed in as ${user.username}` : "Playing without an account on this device."}</p>
      </div>
      <PrimaryButton label="New Game" onClick={onNewGame} />
      {savedAvailable && <PrimaryButton label="Resume Match" onClick={onResume} />}
      {user ? <PrimaryButton label="Online Game" onClick={onOnline} /> : <PrimaryButton label="Login" onClick={onLogin} />}
      <div className="row">
        <SecondaryButton label="Statistics" onClick={onStatistics} />
        <SecondaryButton label="Settings" onClick={onSettings} />
      </div>
      {user && <SecondaryButton label="Log out" onClick={onLogout} />}
    </Screen>
  );
}
