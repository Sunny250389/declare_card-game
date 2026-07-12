const { createDeck, shuffle } = require("./cards");

const MATCH_LIMIT = 100;
const DECLARE_LIMIT = 15;
const DEFAULT_HAND_SIZE = 5;

function createPlayer(input, index) {
  return {
    id: input.id || `player-${index + 1}`,
    name: input.name || `Player ${index + 1}`,
    type: input.type || (index === 0 ? "human" : "ai"),
    difficulty: input.difficulty || "medium",
    totalScore: input.totalScore || 0,
    stats: {
      successfulDeclares: 0,
      failedDeclares: 0,
      specialDeclares: 0,
      roundsWon: 0,
      ...(input.stats || {})
    }
  };
}

function createMatch(config) {
  const players = (config.players || []).map(createPlayer);
  if (players.length < 2 || players.length > 6) {
    throw new Error("Declare supports 2 to 6 players.");
  }

  const base = {
    id: config.id || `match-${Date.now()}`,
    mode: config.mode || "local",
    status: "playing",
    players,
    roundNumber: 0,
    currentPlayerIndex: 0,
    drawPile: [],
    discardPile: [],
    hands: {},
    turn: { hasDrawn: false },
    roundResult: null,
    matchStats: {
      roundsPlayed: 0,
      successfulDeclares: 0,
      failedDeclares: 0,
      specialDeclares: 0,
      startedAt: new Date().toISOString()
    },
    settings: {
      initialHandSize: config.initialHandSize || DEFAULT_HAND_SIZE,
      darkMode: config.darkMode !== false,
      landscape: true,
      accessibilityLabels: true
    },
    eventLog: []
  };

  return startRound(base, config.seed);
}

function startRound(state, seed = Date.now() + state.roundNumber) {
  const deck = createDeck(seed);
  const maxHandSize = Math.max(1, Math.floor((deck.length - 1) / state.players.length));
  const handSize = Math.min(state.settings.initialHandSize, maxHandSize);
  const hands = {};
  const drawPile = [...deck];

  for (const player of state.players) {
    hands[player.id] = drawPile.splice(0, handSize);
  }

  return {
    ...state,
    status: "playing",
    roundNumber: state.roundNumber + 1,
    currentPlayerIndex: 0,
    drawPile,
    discardPile: [],
    hands,
    turn: { hasDrawn: false },
    roundResult: null,
    eventLog: appendEvent(state, "GameStarted", { roundNumber: state.roundNumber + 1 })
  };
}

function appendEvent(state, type, payload = {}) {
  const previous = Array.isArray(state.eventLog) ? state.eventLog : [];
  return [
    ...previous,
    {
      id: `${type}-${previous.length + 1}`,
      type,
      payload,
      at: new Date().toISOString()
    }
  ];
}

function handValue(hand) {
  return hand.reduce((total, card) => total + card.points, 0);
}

function allSameRank(hand) {
  return hand.length > 0 && hand.every((card) => card.rank === hand[0].rank);
}

function currentPlayer(state) {
  return state.players[state.currentPlayerIndex];
}

function requireCurrentTurn(state, playerId) {
  if (state.status !== "playing") throw new Error("Match is not accepting turn actions.");
  if (!currentPlayer(state) || currentPlayer(state).id !== playerId) {
    throw new Error("It is not this player's turn.");
  }
}

function reshuffleDrawPile(state) {
  if (state.drawPile.length > 0 || state.discardPile.length <= 1) return state;
  const topDiscard = state.discardPile[state.discardPile.length - 1];
  const recycled = state.discardPile.slice(0, -1);
  return {
    ...state,
    drawPile: shuffle(recycled, Date.now()),
    discardPile: [topDiscard]
  };
}

function drawCard(state, playerId, source) {
  requireCurrentTurn(state, playerId);
  if (state.turn.hasDrawn) throw new Error("Only one draw action is allowed per turn.");

  let next = source === "draw" ? reshuffleDrawPile(state) : state;
  const fromDrawPile = source === "draw";
  const pile = fromDrawPile ? next.drawPile : next.discardPile;
  if (!pile.length) throw new Error(source === "draw" ? "Draw pile is empty." : "Discard pile is empty.");

  const card = pile[pile.length - 1];
  const updatedPile = pile.slice(0, -1);
  next = {
    ...next,
    drawPile: fromDrawPile ? updatedPile : next.drawPile,
    discardPile: fromDrawPile ? next.discardPile : updatedPile,
    hands: {
      ...next.hands,
      [playerId]: [...next.hands[playerId], card]
    },
    turn: { hasDrawn: true, source },
    eventLog: appendEvent(next, "CardDrawn", { playerId, source })
  };

  return next;
}

function discardCards(state, playerId, cardIds) {
  requireCurrentTurn(state, playerId);
  if (!state.turn.hasDrawn) throw new Error("Draw before discarding.");
  if (!cardIds || cardIds.length === 0) throw new Error("Select at least one card to discard.");
  if (new Set(cardIds).size !== cardIds.length) throw new Error("Discard contains duplicate card IDs.");

  const hand = state.hands[playerId];
  const selected = cardIds.map((id) => hand.find((card) => card.id === id));
  if (selected.some((card) => !card)) throw new Error("Discard contains a card not in hand.");
  if (!selected.every((card) => card.rank === selected[0].rank)) {
    throw new Error("Multiple discarded cards must share an identical rank.");
  }

  const selectedIds = new Set(cardIds);
  const remainingHand = hand.filter((card) => !selectedIds.has(card.id));
  const nextIndex = (state.currentPlayerIndex + 1) % state.players.length;

  return {
    ...state,
    currentPlayerIndex: nextIndex,
    hands: {
      ...state.hands,
      [playerId]: remainingHand
    },
    discardPile: [...state.discardPile, ...selected],
    turn: { hasDrawn: false },
    eventLog: appendEvent(state, "CardsDiscarded", {
      playerId,
      cardIds,
      nextPlayerId: state.players[nextIndex].id
    })
  };
}

function canDeclare(state, playerId) {
  return (
    state.status === "playing" &&
    currentPlayer(state).id === playerId &&
    handValue(state.hands[playerId] || []) < DECLARE_LIMIT
  );
}

function declareRound(state, playerId) {
  requireCurrentTurn(state, playerId);
  if (!canDeclare(state, playerId)) throw new Error("A player may declare only below 15 points.");

  const declareResult = resolveDeclare(state, playerId);
  const players = state.players.map((player) => {
    const delta = declareResult.roundScores[player.id] || 0;
    const declared = player.id === playerId;
    return {
      ...player,
      totalScore: player.totalScore + delta,
      stats: {
        ...player.stats,
        successfulDeclares: player.stats.successfulDeclares + (declared && declareResult.type !== "failed" && declareResult.type !== "tie" ? 1 : 0),
        failedDeclares: player.stats.failedDeclares + (declared && declareResult.type === "failed" ? 1 : 0),
        specialDeclares: player.stats.specialDeclares + (declared && declareResult.type === "same-card-bonus" ? 1 : 0),
        roundsWon: player.stats.roundsWon + (declareResult.zeroScorePlayerIds.includes(player.id) ? 1 : 0)
      }
    };
  });

  const matchFinished = players.some((player) => player.totalScore >= MATCH_LIMIT);
  const matchStats = {
    ...state.matchStats,
    roundsPlayed: state.matchStats.roundsPlayed + 1,
    successfulDeclares: state.matchStats.successfulDeclares + (declareResult.type === "success" || declareResult.type === "same-card-bonus" ? 1 : 0),
    failedDeclares: state.matchStats.failedDeclares + (declareResult.type === "failed" ? 1 : 0),
    specialDeclares: state.matchStats.specialDeclares + (declareResult.type === "same-card-bonus" ? 1 : 0)
  };

  return {
    ...state,
    status: matchFinished ? "matchResult" : "roundResult",
    players,
    roundResult: {
      roundNumber: state.roundNumber,
      declarerId: playerId,
      declareResult,
      hands: state.hands,
      handValues: Object.fromEntries(state.players.map((player) => [player.id, handValue(state.hands[player.id])])),
      cumulativeScores: Object.fromEntries(players.map((player) => [player.id, player.totalScore]))
    },
    matchStats,
    eventLog: appendEvent(state, matchFinished ? "MatchFinished" : "RoundFinished", {
      declarerId: playerId,
      declareResult
    })
  };
}

function resolveDeclare(state, declarerId) {
  const handValues = Object.fromEntries(
    state.players.map((player) => [player.id, handValue(state.hands[player.id])])
  );
  const declarerValue = handValues[declarerId];
  const lowerPlayerIds = state.players
    .filter((player) => player.id !== declarerId && handValues[player.id] < declarerValue)
    .map((player) => player.id);
  const tiedPlayerIds = state.players
    .filter((player) => player.id !== declarerId && handValues[player.id] === declarerValue)
    .map((player) => player.id);

  const roundScores = {};
  let type = "success";
  let zeroScorePlayerIds = [declarerId];

  if (lowerPlayerIds.length > 0) {
    type = "failed";
    zeroScorePlayerIds = lowerPlayerIds;
    for (const player of state.players) {
      if (player.id === declarerId) roundScores[player.id] = 50;
      else if (lowerPlayerIds.includes(player.id)) roundScores[player.id] = 0;
      else roundScores[player.id] = handValues[player.id];
    }
  } else if (tiedPlayerIds.length > 0) {
    type = "tie";
    zeroScorePlayerIds = tiedPlayerIds;
    for (const player of state.players) {
      if (player.id === declarerId) roundScores[player.id] = declarerValue * 2;
      else if (tiedPlayerIds.includes(player.id)) roundScores[player.id] = 0;
      else roundScores[player.id] = handValues[player.id];
    }
  } else {
    const special = allSameRank(state.hands[declarerId]);
    type = special ? "same-card-bonus" : "success";
    for (const player of state.players) {
      if (player.id === declarerId) roundScores[player.id] = special ? -25 : 0;
      else roundScores[player.id] = handValues[player.id];
    }
  }

  return {
    type,
    declarerValue,
    lowerPlayerIds,
    tiedPlayerIds,
    zeroScorePlayerIds,
    roundScores,
    specialBonus: type === "same-card-bonus"
  };
}

function nextRound(state) {
  if (state.status !== "roundResult") throw new Error("A new round can start only after a round result.");
  return startRound(state);
}

function finalLeaderboard(state) {
  return [...state.players].sort((a, b) => a.totalScore - b.totalScore);
}

module.exports = {
  DECLARE_LIMIT,
  MATCH_LIMIT,
  allSameRank,
  canDeclare,
  createMatch,
  currentPlayer,
  declareRound,
  discardCards,
  drawCard,
  finalLeaderboard,
  handValue,
  nextRound,
  resolveDeclare,
  startRound
};
