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
assert.equal(state.discardPile.length, 0);
assert.equal(state.drawPile.length > 0, true);

const current = state.players[state.currentPlayerIndex];
const beforeHandSize = state.hands[current.id].length;
state = drawCard(state, current.id, "draw");
assert.equal(state.turn.hasDrawn, true);
assert.equal(state.hands[current.id].length, beforeHandSize + 1);

const highest = [...state.hands[current.id]].sort((a, b) => b.points - a.points)[0];
state = discardCards(state, current.id, [highest.id]);
assert.equal(state.turn.hasDrawn, false);
assert.equal(state.discardPile[state.discardPile.length - 1].id, highest.id);

state = {
  ...state,
  currentPlayerIndex: 0,
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
  hands: {
    ...state.hands,
    p1: [{ id: "5-S", rank: "5", suit: "spades", points: 5 }]
  }
};
state = drawCard(state, "p1", "draw");
assert.equal(state.drawPile.length, 1);
assert.equal(state.discardPile.length, 1);
assert.equal(state.discardPile[0].id, "4-S");
console.log("Engine smoke test passed.");
