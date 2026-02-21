const crypto = require('crypto');

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]; // 11=J, 12=Q, 13=K, 14=A

function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit });
    }
  }
  return deck;
}

function shuffle(deck) {
  const arr = [...deck];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function hashDeck(deck) {
  return crypto.createHash('sha256').update(JSON.stringify(deck)).digest('hex');
}

function dealCards(shuffledDeck) {
  const half = Math.floor(shuffledDeck.length / 2);
  return {
    player1Hand: shuffledDeck.slice(0, half),
    player2Hand: shuffledDeck.slice(half),
  };
}

function rankLabel(rank) {
  if (rank <= 10) return String(rank);
  return { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }[rank];
}

module.exports = { createDeck, shuffle, hashDeck, dealCards, rankLabel };
