import { cardLabel } from "../engine/cards.js";
import { finalLeaderboard } from "../engine/gameEngine.js";
import { PrimaryButton, ResultBanner, Screen, SecondaryButton, Stat, TopBar } from "../components/ui.jsx";
import { formatDelta, playerName } from "../format.js";

export function RoundResultScreen({ match, onContinue, onMenu }) {
  const result = match.roundResult;
  return (
    <Screen>
      <TopBar title="Round Result" onBack={onMenu} />
      <ResultBanner type={result.declareResult.type} declarer={playerName(match, result.declarerId)} />
      {match.players.map((player) => (
        <div key={player.id} className="panel">
          <div className="score-row">
            <span className="result-name">{player.name}</span>
            <span className="result-score">{formatDelta(result.declareResult.roundScores[player.id])} / {player.totalScore}</span>
          </div>
          <p className="muted">{result.hands[player.id].map(cardLabel).join("  ")} - value {result.handValues[player.id]}</p>
        </div>
      ))}
      <PrimaryButton label="Next Round" onClick={onContinue} />
    </Screen>
  );
}

export function MatchResultScreen({ match, onPlayAgain, onNewMatch, onExit }) {
  const leaderboard = finalLeaderboard(match);
  return (
    <Screen>
      <p className="kicker">WINNER</p>
      <h1 className="title">{leaderboard[0].name}</h1>
      {leaderboard.map((player, index) => (
        <div key={player.id} className="leader-row">
          <span className="result-name">{index + 1}. {player.name}</span>
          <span className="result-score">{player.totalScore}</span>
        </div>
      ))}
      <MatchStats match={match} />
      <PrimaryButton label="Play Again" onClick={onPlayAgain} />
      <div className="row">
        <SecondaryButton label="New Match" onClick={onNewMatch} />
        <SecondaryButton label="Exit" onClick={onExit} />
      </div>
    </Screen>
  );
}

export function MatchStats({ match }) {
  return (
    <div className="stats-grid">
      <Stat label="Rounds" value={match.matchStats.roundsPlayed} />
      <Stat label="Success" value={match.matchStats.successfulDeclares} />
      <Stat label="Failed" value={match.matchStats.failedDeclares} />
      <Stat label="Special" value={match.matchStats.specialDeclares} />
    </div>
  );
}
