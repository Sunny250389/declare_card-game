import { describe, expect, it, vi, afterEach } from "vitest";
import { chooseDiscardIds, chooseDrawSource, playAITurn, playUntilHumanTurn, shouldDeclare } from "../../src/engine/ai.js";
import { createMatch } from "../../src/engine/gameEngine.js";

const card = (id, rank, points) => ({ id, rank, suit: "spades", points });

function players(types) {
  return types.map((type, index) => ({
    id: `p${index + 1}`,
    name: `Player ${index + 1}`,
    type,
    difficulty: "medium"
  }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AI turns", () => {
  it("discards before picking up, and passes the turn to the next player", () => {
    const state = createMatch({ players: players(["ai", "ai", "ai"]), seed: 21 });
    // A high hand, so the AI does not declare and must play a full turn.
    const highHand = {
      ...state,
      hands: { ...state.hands, p1: [card("K-S", "K", 10), card("Q-S", "Q", 10), card("J-S", "J", 10)] }
    };
    const next = playAITurn(highHand);
    expect(next.status).toBe("playing");
    expect(next.hands.p1).toHaveLength(3);
    expect(next.currentPlayerIndex).toBe(1);
    expect(next.turn).toEqual({ hasDiscarded: false, hasDrawn: false, pickupCardId: null });
  });

  it("never takes a turn for a human player", () => {
    const state = createMatch({ players: players(["human", "ai"]), seed: 21 });
    expect(playAITurn(state)).toBe(state);
  });

  it("plays AI players until it is a human's turn", () => {
    let state = createMatch({ players: players(["ai", "ai", "human"]), seed: 33 });
    state = playUntilHumanTurn(state);
    const waitingForHuman = state.status !== "playing" || state.players[state.currentPlayerIndex].type === "human";
    expect(waitingForHuman).toBe(true);
  });

  it("plays a whole round of AI players without getting stuck", () => {
    let state = createMatch({ players: players(["ai", "ai", "ai", "ai"]), seed: 11 });
    for (let turn = 0; turn < 200 && state.status === "playing"; turn += 1) {
      state = playAITurn(state);
    }
    expect(["playing", "roundResult", "matchResult"]).toContain(state.status);
  });
});

describe("AI decisions", () => {
  it("declares when the hand is low enough for its difficulty", () => {
    const state = createMatch({ players: players(["ai", "ai"]), seed: 4 });
    const low = {
      ...state,
      currentPlayerIndex: 0,
      turn: { hasDiscarded: false, hasDrawn: false, pickupCardId: null },
      hands: { ...state.hands, p1: [card("2-S", "2", 2), card("3-S", "3", 3)] }
    };
    expect(shouldDeclare(low, low.players[0])).toBe(true);
  });

  it("does not declare when its hand is above the threshold", () => {
    const state = createMatch({ players: players(["ai", "ai"]), seed: 4 });
    const high = {
      ...state,
      currentPlayerIndex: 0,
      turn: { hasDiscarded: false, hasDrawn: false, pickupCardId: null },
      hands: { ...state.hands, p1: [card("K-S", "K", 10), card("Q-S", "Q", 10)] }
    };
    expect(shouldDeclare(high, high.players[0])).toBe(false);
  });

  it("discards a group of cards that share a rank when it has one", () => {
    const state = createMatch({ players: players(["ai", "ai"]), seed: 4 });
    const hand = [card("7-S", "7", 7), card("7-H", "7", 7), card("K-S", "K", 10)];
    const ids = chooseDiscardIds({ ...state, hands: { ...state.hands, p1: hand } }, state.players[0]);
    expect(ids.sort()).toEqual(["7-H", "7-S"]);
  });

  it("discards its highest card when there is no pair", () => {
    const state = createMatch({ players: players(["ai", "ai"]), seed: 4 });
    const hand = [card("2-S", "2", 2), card("K-S", "K", 10), card("5-S", "5", 5)];
    const ids = chooseDiscardIds({ ...state, hands: { ...state.hands, p1: hand } }, state.players[0]);
    expect(ids).toEqual(["K-S"]);
  });

  it("picks up the pickup card when it matches a card in hand", () => {
    const state = createMatch({ players: players(["ai", "ai"]), seed: 4 });
    const pickup = card("9-H", "9", 9);
    const next = {
      ...state,
      discardPile: [pickup],
      turn: { hasDiscarded: true, hasDrawn: false, pickupCardId: "9-H" },
      hands: { ...state.hands, p1: [card("9-S", "9", 9)] }
    };
    expect(chooseDrawSource(next, next.players[0])).toBe("discard");
  });

  it("draws from the draw pile when the pickup card is not useful", () => {
    const state = createMatch({ players: players(["ai", "ai"]), seed: 4 });
    const next = {
      ...state,
      discardPile: [card("K-H", "K", 10)],
      turn: { hasDiscarded: true, hasDrawn: false, pickupCardId: "K-H" },
      hands: { ...state.hands, p1: [card("2-S", "2", 2)] }
    };
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    expect(chooseDrawSource(next, next.players[0])).toBe("draw");
  });
});
