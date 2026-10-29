import { describe, expect, it } from "vitest";
import {
  canDeclare,
  createMatch,
  declareRound,
  discardCards,
  drawCard,
  finalLeaderboard,
  handValue,
  nextRound
} from "../../src/engine/gameEngine.js";

function makePlayers(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `p${index + 1}`,
    name: `Player ${index + 1}`,
    type: index === 0 ? "human" : "ai",
    difficulty: "medium"
  }));
}

const card = (id, rank, points) => ({ id, rank, suit: "spades", points });

// Replace hands and turn state so a test can describe an exact position.
function position(state, { hands, current = 0, turn = { hasDiscarded: false, hasDrawn: false, pickupCardId: null }, discardPile, drawPile }) {
  return {
    ...state,
    currentPlayerIndex: current,
    turn,
    hands: { ...state.hands, ...hands },
    ...(discardPile ? { discardPile } : {}),
    ...(drawPile ? { drawPile } : {})
  };
}

describe("createMatch and rounds", () => {
  it("deals five cards to each player and opens the discard pile with one card", () => {
    const state = createMatch({ players: makePlayers(4), seed: 42 });
    expect(Object.values(state.hands).every((hand) => hand.length === 5)).toBe(true);
    expect(state.discardPile).toHaveLength(1);
    expect(state.drawPile).toHaveLength(52 - 20 - 1);
    expect(state.roundNumber).toBe(1);
    expect(state.turn).toEqual({ hasDiscarded: false, hasDrawn: false, pickupCardId: null });
  });

  it("requires between two and six players", () => {
    expect(() => createMatch({ players: makePlayers(1) })).toThrow("2 to 6 players");
    expect(() => createMatch({ players: makePlayers(7) })).toThrow("2 to 6 players");
  });

  it("starts the next round with a fresh discard pile", () => {
    let state = createMatch({ players: makePlayers(2), seed: 3 });
    state = position(state, {
      hands: { p1: [card("A-S", "A", 1), card("A-H", "A", 1)] },
      turn: { hasDiscarded: false, hasDrawn: false, pickupCardId: null }
    });
    state = declareRound(state, "p1");
    state = nextRound(state);
    expect(state.status).toBe("playing");
    expect(state.discardPile).toHaveLength(1);
    expect(state.roundNumber).toBe(2);
  });

  it("refuses a new round until the current one has a result", () => {
    const state = createMatch({ players: makePlayers(2), seed: 3 });
    expect(() => nextRound(state)).toThrow("only after a round result");
  });
});

describe("turn order: discard first, then pick up", () => {
  it("refuses to pick up before discarding", () => {
    const state = createMatch({ players: makePlayers(3), seed: 5 });
    expect(() => drawCard(state, "p1", "discard")).toThrow("Discard before picking up");
    expect(() => drawCard(state, "p1", "draw")).toThrow("Discard before picking up");
  });

  it("keeps the turn after discarding and records the pickup card", () => {
    const state = createMatch({ players: makePlayers(3), seed: 5 });
    const starter = state.discardPile[0];
    const after = discardCards(state, "p1", [state.hands.p1[0].id]);
    expect(after.turn.hasDiscarded).toBe(true);
    expect(after.turn.hasDrawn).toBe(false);
    expect(after.currentPlayerIndex).toBe(0);
    expect(after.turn.pickupCardId).toBe(starter.id);
  });

  it("does not allow a second discard in the same turn", () => {
    const state = createMatch({ players: makePlayers(3), seed: 5 });
    const discarded = discardCards(state, "p1", [state.hands.p1[0].id]);
    expect(() => discardCards(discarded, "p1", [discarded.hands.p1[0].id])).toThrow("already discarded");
  });

  it("picks up the card that was on top before this turn's discard, and passes the turn", () => {
    let state = createMatch({ players: makePlayers(3), seed: 5 });
    const starter = state.discardPile[0];
    state = discardCards(state, "p1", [state.hands.p1[0].id]);
    const handSize = state.hands.p1.length;
    state = drawCard(state, "p1", "discard");
    expect(state.hands.p1).toHaveLength(handSize + 1);
    expect(state.hands.p1.some((item) => item.id === starter.id)).toBe(true);
    expect(state.discardPile.some((item) => item.id === starter.id)).toBe(false);
    expect(state.currentPlayerIndex).toBe(1);
    expect(state.turn).toEqual({ hasDiscarded: false, hasDrawn: false, pickupCardId: null });
  });

  it("cannot pick up a card discarded in the same turn", () => {
    let state = createMatch({ players: makePlayers(3), seed: 5 });
    const mine = state.hands.p1[0];
    state = discardCards(state, "p1", [mine.id]);
    expect(state.turn.pickupCardId).not.toBe(mine.id);
  });

  it("draws from the draw pile and passes the turn", () => {
    let state = createMatch({ players: makePlayers(3), seed: 5 });
    state = discardCards(state, "p1", [state.hands.p1[0].id]);
    const drawBefore = state.drawPile.length;
    state = drawCard(state, "p1", "draw");
    expect(state.drawPile).toHaveLength(drawBefore - 1);
    expect(state.currentPlayerIndex).toBe(1);
  });

  it("rejects an unknown pick-up source", () => {
    let state = createMatch({ players: makePlayers(3), seed: 5 });
    state = discardCards(state, "p1", [state.hands.p1[0].id]);
    expect(() => drawCard(state, "p1", "table")).toThrow("draw pile or the discard pile");
  });

  it("only lets the current player act", () => {
    const state = createMatch({ players: makePlayers(3), seed: 5 });
    expect(() => discardCards(state, "p2", [state.hands.p2[0].id])).toThrow("not this player's turn");
  });

  it("reshuffles the discard pile into the draw pile when the draw pile is empty, keeping the top card", () => {
    let state = createMatch({ players: makePlayers(2), seed: 9 });
    state = position(state, {
      hands: { p1: [card("5-S", "5", 5), card("6-S", "6", 6)] },
      discardPile: [card("2-S", "2", 2), card("3-S", "3", 3), card("4-S", "4", 4)],
      drawPile: [],
      turn: { hasDiscarded: true, hasDrawn: false, pickupCardId: "2-S" }
    });
    state = drawCard(state, "p1", "draw");
    expect(state.discardPile.map((item) => item.id)).toEqual(["4-S"]);
    expect(state.drawPile).toHaveLength(1);
  });
});

describe("declaring", () => {
  it("is allowed before discarding, at 15 points or less", () => {
    const state = createMatch({ players: makePlayers(2), seed: 1 });
    const at15 = position(state, { hands: { p1: [card("10-S", "10", 10), card("5-S", "5", 5)] } });
    const at16 = position(state, { hands: { p1: [card("10-S", "10", 10), card("6-S", "6", 6)] } });
    expect(handValue(at15.hands.p1)).toBe(15);
    expect(canDeclare(at15, "p1")).toBe(true);
    expect(canDeclare(at16, "p1")).toBe(false);
  });

  it("is blocked once the player has discarded, and the error says why", () => {
    const state = createMatch({ players: makePlayers(2), seed: 1 });
    const discarded = discardCards(state, "p1", [state.hands.p1[0].id]);
    expect(canDeclare(discarded, "p1")).toBe(false);
    expect(() => declareRound(discarded, "p1")).toThrow("before discarding");
  });

  it("scores a failed declare: declarer gets 50 and lower hands get 0", () => {
    let state = createMatch({ players: makePlayers(3), seed: 7 });
    state = position(state, {
      hands: { p1: [card("9-S", "9", 9)], p2: [card("8-S", "8", 8)], p3: [card("K-H", "K", 10)] }
    });
    state = declareRound(state, "p1");
    expect(state.roundResult.declareResult.type).toBe("failed");
    expect(state.roundResult.declareResult.roundScores.p1).toBe(50);
    expect(state.roundResult.declareResult.roundScores.p2).toBe(0);
  });

  it("scores a tie: declarer gets double their value", () => {
    let state = createMatch({ players: makePlayers(3), seed: 8 });
    state = position(state, {
      hands: { p1: [card("9-S", "9", 9)], p2: [card("9-H", "9", 9)], p3: [card("K-H", "K", 10)] }
    });
    state = declareRound(state, "p1");
    expect(state.roundResult.declareResult.type).toBe("tie");
    expect(state.roundResult.declareResult.roundScores.p1).toBe(18);
    expect(state.roundResult.declareResult.roundScores.p2).toBe(0);
  });

  it("gives -25 for a same-rank hand", () => {
    let state = createMatch({ players: makePlayers(2), seed: 2 });
    state = position(state, {
      hands: { p1: [card("A-S", "A", 1), card("A-H", "A", 1)], p2: [card("K-S", "K", 10)] }
    });
    state = declareRound(state, "p1");
    expect(state.roundResult.declareResult.type).toBe("same-card-bonus");
    expect(state.players[0].totalScore).toBe(-25);
  });

  it("scores a successful declare: other players keep their hand values", () => {
    let state = createMatch({ players: makePlayers(2), seed: 4 });
    state = position(state, {
      hands: { p1: [card("2-S", "2", 2), card("3-S", "3", 3)], p2: [card("K-S", "K", 10), card("4-H", "4", 4)] }
    });
    state = declareRound(state, "p1");
    expect(state.roundResult.declareResult.type).toBe("success");
    expect(state.roundResult.declareResult.roundScores).toEqual({ p1: 0, p2: 14 });
  });

  it("ends the match once a player reaches 100 points", () => {
    let state = createMatch({ players: makePlayers(2), seed: 4 });
    state.players[1].totalScore = 95;
    state = position(state, {
      hands: { p1: [card("2-S", "2", 2)], p2: [card("K-S", "K", 10)] }
    });
    state = declareRound(state, "p1");
    expect(state.status).toBe("matchResult");
  });
});

describe("leaderboard", () => {
  it("orders players by lowest total score first", () => {
    const state = createMatch({ players: makePlayers(3), seed: 1 });
    state.players[0].totalScore = 40;
    state.players[1].totalScore = 10;
    state.players[2].totalScore = 25;
    expect(finalLeaderboard(state).map((player) => player.id)).toEqual(["p2", "p3", "p1"]);
  });
});
