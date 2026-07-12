const SUITS = ["spades", "hearts", "diamonds", "clubs"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

function rankPoints(rank) {
  if (rank === "A") return 1;
  if (["J", "Q", "K"].includes(rank)) return 10;
  return Number(rank);
}

function createSeededRandom(seed = Date.now()) {
  let value = seed % 2147483647;
  if (value <= 0) value += 2147483646;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

function createDeck(seed) {
  const cards = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      cards.push({
        id: `${rank}-${suit}`,
        rank,
        suit,
        points: rankPoints(rank)
      });
    }
  }
  return shuffle(cards, seed);
}

function shuffle(cards, seed) {
  const random = createSeededRandom(seed);
  const copy = [...cards];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function cardLabel(card) {
  const suit = {
    spades: "S",
    hearts: "H",
    diamonds: "D",
    clubs: "C"
  }[card.suit];
  return `${card.rank}${suit}`;
}

module.exports = {
  SUITS,
  RANKS,
  cardLabel,
  createDeck,
  shuffle,
  rankPoints
};
