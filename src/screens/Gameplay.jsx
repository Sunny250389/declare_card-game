import { canDeclare, currentPlayer, handValue } from "../engine/gameEngine.js";
import { CardButton, Pile, PrimaryButton, Screen, ScoreboardPanel, TopBar } from "../components/ui.jsx";

// The hand the viewer may see. Online, it is always the viewer's own hand.
// Locally, the hand shows only for a human player; during an AI turn it stays hidden.
export function visibleHand(match, localPlayerId) {
  const player = currentPlayer(match);
  if (localPlayerId) return match.hands[localPlayerId] || [];
  if (player.type === "human") return match.hands[player.id] || [];
  return [];
}

// Before discarding, the discard pile shows its top card. After discarding, it shows the pickup card.
export function pickupCardFor(match) {
  if (match.turn.hasDiscarded) return match.discardPile.find((card) => card.id === match.turn.pickupCardId);
  return match.discardPile[match.discardPile.length - 1];
}

export function GameplayScreen({ match, localPlayerId, selectedIds, onSelectCard, onDraw, onDiscard, onDeclare, onMenu }) {
  const player = currentPlayer(match);
  const hand = visibleHand(match, localPlayerId);
  const canInteract = player.type === "human" && (!localPlayerId || player.id === localPlayerId);
  const discarded = match.turn.hasDiscarded;
  const drawn = match.turn.hasDrawn;
  const pickupCard = pickupCardFor(match);
  const canDrawFromDrawPile = match.drawPile.length > 0 || match.discardPile.length > 1;
  const hint = !canInteract
    ? ""
    : discarded
      ? "Step 2: pick up the card from the discard pile or draw one from the draw pile."
      : "Step 1: select cards of one rank and discard them.";

  return (
    <Screen>
      <TopBar title={`Round ${match.roundNumber}`} onBack={onMenu} />
      <section className="band">
        <p className="band-title">{player.name}'s turn</p>
        <p className="band-text">{canInteract ? `Hand value ${handValue(hand)}` : `${player.name} is playing`}</p>
      </section>
      <ScoreboardPanel match={match} />
      <div className="piles">
        <Pile label="Draw" count={match.drawPile.length || "Mix"} onClick={() => onDraw("draw")} disabled={!canInteract || !discarded || drawn || !canDrawFromDrawPile} />
        <Pile
          label="Discard"
          count={match.discardPile.length}
          top={pickupCard}
          onClick={() => onDraw("discard")}
          disabled={!canInteract || !discarded || drawn || !pickupCard}
        />
      </div>
      <p className="label">{localPlayerId ? "Your hand" : "Hand"}</p>
      <div className="hand">
        {hand.map((card) => (
          <CardButton key={card.id} card={card} selected={selectedIds.includes(card.id)} onClick={() => onSelectCard(card)} disabled={!canInteract} />
        ))}
      </div>
      {hint && <p className="status-text">{hint}</p>}
      <div className="action-bar">
        <PrimaryButton label="Declare" disabled={!canInteract || !canDeclare(match, player.id)} onClick={onDeclare} />
        <PrimaryButton label="Discard" disabled={!canInteract || discarded || selectedIds.length === 0} onClick={onDiscard} />
      </div>
    </Screen>
  );
}
