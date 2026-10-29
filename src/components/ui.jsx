import { useEffect } from "react";
import { cardLabel } from "../engine/cards.js";
import { finalLeaderboard } from "../engine/gameEngine.js";

export function Screen({ children }) {
  return <main className="screen">{children}</main>;
}

export function TopBar({ title, onBack }) {
  return (
    <header className="top-bar">
      <SecondaryButton label="Back" onClick={onBack} compact />
      <h2 className="heading">{title}</h2>
      <span className="top-spacer" aria-hidden="true" />
    </header>
  );
}

export function PrimaryButton({ label, onClick, disabled }) {
  return (
    <button type="button" className="btn primary" onClick={onClick} disabled={disabled}>
      {label}
    </button>
  );
}

export function SecondaryButton({ label, onClick, compact, disabled }) {
  return (
    <button type="button" className={`btn secondary${compact ? " compact" : ""}`} onClick={onClick} disabled={disabled}>
      {label}
    </button>
  );
}

export function Segment({ label, active, onClick, className = "segment" }) {
  return (
    <button type="button" className={`${className}${active ? " active" : ""}`} onClick={onClick} aria-pressed={active}>
      {label}
    </button>
  );
}

export function Field({ label, children }) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

export function CardButton({ card, selected, onClick, disabled }) {
  return (
    <button
      type="button"
      className={`card${selected ? " selected" : ""}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={`${card.rank} of ${card.suit}`}
      aria-pressed={selected}
    >
      <span className="card-rank">{card.rank}</span>
      <span className="card-suit">{card.suit[0].toUpperCase()}</span>
    </button>
  );
}

export function Pile({ label, count, top, onClick, disabled }) {
  return (
    <button type="button" className="pile" onClick={onClick} disabled={disabled}>
      <span className="pile-label">{label}</span>
      <span className="pile-top">{top ? cardLabel(top) : count}</span>
    </button>
  );
}

export function Stat({ label, value }) {
  return (
    <div className="stat-box">
      <span className="stat-value">{value}</span>
      <span className="muted">{label}</span>
    </div>
  );
}

export function ResultBanner({ type, declarer }) {
  const copy = {
    success: "Successful Declare",
    failed: "Failed Declare",
    tie: "Tie Declare",
    "same-card-bonus": "Same Card Bonus"
  }[type];
  return (
    <section className="band">
      <p className="band-title">{copy}</p>
      <p className="band-text">{declarer}</p>
    </section>
  );
}

export function ScoreboardPanel({ match }) {
  return (
    <section className="panel">
      <p className="label">Scorecard</p>
      {finalLeaderboard(match).map((player) => (
        <div key={player.id} className="score-row">
          <span className="result-name">{player.name}</span>
          <span className="result-score">{player.totalScore}</span>
        </div>
      ))}
    </section>
  );
}

// Shows a short message, then clears itself. Used instead of native alerts.
export function Toast({ notice, onDismiss }) {
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(onDismiss, 4000);
    return () => clearTimeout(timer);
  }, [notice, onDismiss]);
  if (!notice) return null;
  return (
    <div className="toast" role="status">
      {notice.text}
    </div>
  );
}
