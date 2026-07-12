const { canDeclare, declareRound, discardCards, drawCard, handValue } = require("./gameEngine");

function shouldDeclare(state, player) {
  const value = handValue(state.hands[player.id]);
  if (!canDeclare(state, player.id)) return false;
  if (player.difficulty === "easy") return value < 10 && Math.random() < 0.25;
  if (player.difficulty === "medium") return value < 9;

  const opponentKnownPressure = state.discardPile.slice(-8).reduce((total, card) => total + card.points, 0) / 8 || 6;
  const duplicateBonus = hasAllSameOrPair(state.hands[player.id]) ? 2 : 0;
  return value <= Math.max(5, Math.round(opponentKnownPressure + duplicateBonus));
}

function chooseDrawSource(state, player) {
  const topDiscard = state.discardPile[state.discardPile.length - 1];
  if (!topDiscard) return "draw";
  const hand = state.hands[player.id];
  const matchingCount = hand.filter((card) => card.rank === topDiscard.rank).length;

  if (player.difficulty === "easy") return Math.random() < 0.35 ? "discard" : "draw";
  if (matchingCount > 0) return "discard";
  if (player.difficulty === "medium") return topDiscard.points <= 5 ? "discard" : "draw";

  const averageHandCard = handValue(hand) / Math.max(1, hand.length);
  return topDiscard.points <= averageHandCard ? "discard" : "draw";
}

function chooseDiscardIds(state, player) {
  const hand = state.hands[player.id];
  const groups = groupByRank(hand);
  const duplicateGroups = [...groups.values()].filter((cards) => cards.length > 1);

  if (player.difficulty !== "easy" && duplicateGroups.length > 0) {
    duplicateGroups.sort((a, b) => groupScore(b) - groupScore(a));
    return duplicateGroups[0].map((card) => card.id);
  }

  if (player.difficulty === "easy" && duplicateGroups.length > 0 && Math.random() < 0.45) {
    return duplicateGroups[Math.floor(Math.random() * duplicateGroups.length)].map((card) => card.id);
  }

  const highest = [...hand].sort((a, b) => b.points - a.points)[0];
  return [highest.id];
}

function playAITurn(state) {
  const player = state.players[state.currentPlayerIndex];
  if (!player || player.type !== "ai" || state.status !== "playing") return state;

  if (shouldDeclare(state, player)) {
    return declareRound(state, player.id);
  }

  const source = chooseDrawSource(state, player);
  let next = drawCard(state, player.id, source);
  const discardIds = chooseDiscardIds(next, player);
  next = discardCards(next, player.id, discardIds);
  return next;
}

function playUntilHumanTurn(state, maxTurns = 20) {
  let next = state;
  let turns = 0;
  while (
    next.status === "playing" &&
    next.players[next.currentPlayerIndex].type === "ai" &&
    turns < maxTurns
  ) {
    next = playAITurn(next);
    turns += 1;
  }
  return next;
}

function groupByRank(hand) {
  const groups = new Map();
  for (const card of hand) {
    const cards = groups.get(card.rank) || [];
    groups.set(card.rank, [...cards, card]);
  }
  return groups;
}

function groupScore(cards) {
  return cards.reduce((total, card) => total + card.points, 0);
}

function hasAllSameOrPair(hand) {
  if (hand.length === 0) return false;
  if (hand.every((card) => card.rank === hand[0].rank)) return true;
  return [...groupByRank(hand).values()].some((cards) => cards.length > 1);
}

module.exports = {
  chooseDiscardIds,
  chooseDrawSource,
  playAITurn,
  playUntilHumanTurn,
  shouldDeclare
};
