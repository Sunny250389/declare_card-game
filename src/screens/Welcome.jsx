import { PrimaryButton, Screen, SecondaryButton } from "../components/ui.jsx";

export function WelcomeScreen({ onLogin, onPlayWithoutAccount }) {
  return (
    <Screen>
      <div className="hero">
        <p className="kicker">DECLARE</p>
        <h1 className="title">Lowest hand wins.</h1>
        <p className="muted">Sign in to play online with friends, or play on this device without an account.</p>
      </div>
      <PrimaryButton label="Login or Sign Up" onClick={onLogin} />
      <SecondaryButton label="Play without account" onClick={onPlayWithoutAccount} />
      <p className="muted small">
        <a href="/privacy.html" target="_blank" rel="noreferrer">Privacy policy</a>
      </p>
    </Screen>
  );
}
