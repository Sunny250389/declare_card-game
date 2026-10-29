const assert = require("assert");
const {
  createMatch,
  drawCard,
  discardCards,
  declareRound,
  handValue,
  canDeclare,
  nextRound
} = require("../src/engine/gameEngine");
const { playAITurn } = require("../src/engine/ai");

function makePlayers(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `p${index + 1}`,
    name: `Player ${index + 1}`,
    type: index === 0 ? "human" : "ai",
    difficulty: "medium"
  }));
}

let state = createMatch({ players: makePlayers(4), seed: 42 });
assert.equal(state.players.length, 4);
assert.equal(Object.values(state.hands).every((hand) => hand.length === 5), true);
assert.equal(state.discardPile.length, 1, "round starts with one card on the discard pile");
assert.equal(state.drawPile.length > 0, true);

// Picking up before discarding is not allowed.
const first = state.players[state.currentPlayerIndex];
assert.throws(() => drawCard(state, first.id, "discard"), /Discard before picking up/);
assert.throws(() => drawCard(state, first.id, "draw"), /Discard before picking up/);

// Discard first. The turn does not end yet.
const starter = state.discardPile[0];
const highest = [...state.hands[first.id]].sort((a, b) => b.points - a.points)[0];
state = discardCards(state, first.id, [highest.id]);
assert.equal(state.turn.hasDiscarded, true);
assert.equal(state.turn.hasDrawn, false);
assert.equal(state.currentPlayerIndex, 0, "turn stays with the same player after discarding");
assert.equal(state.turn.pickupCardId, starter.id, "the starter card is the card available to pick up");
assert.throws(() => discardCards(state, first.id, [state.hands[first.id][0].id]), /already discarded/);
// Declaring is only allowed before the discard. After discarding, the player must pick up first.
assert.equal(canDeclare(state, first.id), false);
assert.throws(() => declareRound(state, first.id), /before discarding/);

// Pick up the card that was on the discard pile before the discard.
const handSize = state.hands[first.id].length;
state = drawCard(state, first.id, "discard");
assert.equal(state.hands[first.id].length, handSize + 1);
assert.equal(state.hands[first.id].some((card) => card.id === starter.id), true);
assert.equal(state.currentPlayerIndex, 1, "picking up ends the turn");
assert.equal(state.turn.hasDiscarded, false);
assert.equal(state.discardPile.some((card) => card.id === starter.id), false);

// The card discarded this turn is never the pickup card; the pickup is the card below it.
const second = state.players[state.currentPlayerIndex];
const cardToDiscard = state.hands[second.id][0];
state = discardCards(state, second.id, [cardToDiscard.id]);
assert.notEqual(state.turn.pickupCardId, cardToDiscard.id);
state = drawCard(state, second.id, "draw");
assert.equal(state.currentPlayerIndex, 2);

// Declare check on a hand built by hand.
state = {
  ...state,
  currentPlayerIndex: 0,
  turn: { hasDiscarded: false, hasDrawn: false, pickupCardId: null },
  hands: {
    ...state.hands,
    p1: [
      { id: "A-S", rank: "A", suit: "spades", points: 1 },
      { id: "A-H", rank: "A", suit: "hearts", points: 1 }
    ],
    p2: [{ id: "K-S", rank: "K", suit: "spades", points: 10 }],
    p3: [{ id: "Q-S", rank: "Q", suit: "spades", points: 10 }],
    p4: [{ id: "J-S", rank: "J", suit: "spades", points: 10 }]
  }
};
assert.equal(handValue(state.hands.p1), 2);
assert.equal(canDeclare(state, "p1"), true);
state = declareRound(state, "p1");
assert.equal(state.roundResult.declareResult.type, "same-card-bonus");
assert.equal(state.players[0].totalScore, -25);

state = nextRound(state);
assert.equal(state.status, "playing");
assert.equal(state.discardPile.length, 1);

// Declare is allowed at 15 points or less, and not above.
const atLimit = { ...state, currentPlayerIndex: 0, turn: { hasDiscarded: false, hasDrawn: false, pickupCardId: null }, hands: { ...state.hands, p1: [{ id: "10-S", rank: "10", suit: "spades", points: 10 }, { id: "5-S", rank: "5", suit: "spades", points: 5 }] } };
assert.equal(handValue(atLimit.hands.p1), 15);
assert.equal(canDeclare(atLimit, "p1"), true);
const aboveLimit = { ...atLimit, hands: { ...atLimit.hands, p1: [{ id: "10-S", rank: "10", suit: "spades", points: 10 }, { id: "6-S", rank: "6", suit: "spades", points: 6 }] } };
assert.equal(canDeclare(aboveLimit, "p1"), false);

state = createMatch({ players: makePlayers(3), seed: 7 });
state = {
  ...state,
  currentPlayerIndex: 0,
  hands: {
    p1: [{ id: "9-S", rank: "9", suit: "spades", points: 9 }],
    p2: [{ id: "8-S", rank: "8", suit: "spades", points: 8 }],
    p3: [{ id: "K-H", rank: "K", suit: "hearts", points: 10 }]
  }
};
state = declareRound(state, "p1");
assert.equal(state.roundResult.declareResult.type, "failed");
assert.equal(state.roundResult.declareResult.roundScores.p1, 50);
assert.equal(state.roundResult.declareResult.roundScores.p2, 0);

state = createMatch({ players: makePlayers(3), seed: 8 });
state = {
  ...state,
  currentPlayerIndex: 0,
  hands: {
    p1: [{ id: "9-S", rank: "9", suit: "spades", points: 9 }],
    p2: [{ id: "9-H", rank: "9", suit: "hearts", points: 9 }],
    p3: [{ id: "K-H", rank: "K", suit: "hearts", points: 10 }]
  }
};
state = declareRound(state, "p1");
assert.equal(state.roundResult.declareResult.type, "tie");
assert.equal(state.roundResult.declareResult.roundScores.p1, 18);
assert.equal(state.roundResult.declareResult.roundScores.p2, 0);

// Empty draw pile: the discard pile is reshuffled, keeping its top card.
state = createMatch({ players: makePlayers(2), seed: 9 });
state = {
  ...state,
  drawPile: [],
  discardPile: [
    { id: "2-S", rank: "2", suit: "spades", points: 2 },
    { id: "3-S", rank: "3", suit: "spades", points: 3 },
    { id: "4-S", rank: "4", suit: "spades", points: 4 }
  ],
  currentPlayerIndex: 0,
  turn: { hasDiscarded: true, hasDrawn: false, pickupCardId: "2-S" },
  hands: {
    ...state.hands,
    p1: [{ id: "5-S", rank: "5", suit: "spades", points: 5 }]
  }
};
state = drawCard(state, "p1", "draw");
assert.equal(state.drawPile.length, 1);
assert.equal(state.discardPile.length, 1);
assert.equal(state.discardPile[0].id, "4-S");

// AI turns follow the same order: discard, then pick up. Run a full round of AI play.
state = createMatch({ players: makePlayers(4).map((player, index) => ({ ...player, type: "ai", difficulty: index % 2 ? "hard" : "easy" })), seed: 11 });
for (let turn = 0; turn < 40 && state.status === "playing"; turn += 1) {
  const before = state.currentPlayerIndex;
  state = playAITurn(state);
  if (state.status === "playing") {
    assert.equal(state.turn.hasDiscarded, false, "AI turn finished cleanly");
    assert.notEqual(state.currentPlayerIndex, before, "AI turn passes to the next player");
  }
}
assert.equal(["playing", "roundResult", "matchResult"].includes(state.status), true);

console.log("Engine smoke test passed.");
