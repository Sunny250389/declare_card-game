import { describe, expect, it } from "vitest";
import { RANKS, SUITS, cardLabel, createDeck, rankPoints, shuffle } from "../../src/engine/cards.js";

describe("cards", () => {
  it("uses four suits and thirteen ranks", () => {
    expect(SUITS).toEqual(["spades", "hearts", "diamonds", "clubs"]);
    expect(RANKS).toHaveLength(13);
  });

  it("gives ace one point, face cards ten, and number cards their value", () => {
    expect(rankPoints("A")).toBe(1);
    expect(rankPoints("J")).toBe(10);
    expect(rankPoints("Q")).toBe(10);
    expect(rankPoints("K")).toBe(10);
    expect(rankPoints("7")).toBe(7);
    expect(rankPoints("10")).toBe(10);
  });

  it("creates a full deck of 52 unique cards", () => {
    const deck = createDeck(1);
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map((card) => card.id)).size).toBe(52);
  });

  it("labels cards with rank and suit initial", () => {
    expect(cardLabel({ rank: "10", suit: "hearts" })).toBe("10H");
    expect(cardLabel({ rank: "A", suit: "spades" })).toBe("AS");
  });

  it("shuffles the same way for the same seed and does not change the input", () => {
    const cards = [1, 2, 3, 4, 5, 6, 7, 8];
    const first = shuffle(cards, 42);
    expect(shuffle(cards, 42)).toEqual(first);
    expect(cards).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...first].sort((a, b) => a - b)).toEqual(cards);
  });

  it("changes the order for a different seed", () => {
    const cards = Array.from({ length: 20 }, (_, index) => index);
    expect(shuffle(cards, 1)).not.toEqual(shuffle(cards, 2));
  });
});
