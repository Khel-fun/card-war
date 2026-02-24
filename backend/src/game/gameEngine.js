const { createDeck, shuffle, hashDeck, dealCards } = require('./deck');

const MAX_ROUNDS = 5;

class GameEngine {
  constructor(gameId, player1Id, player2Id) {
    this.gameId = gameId;
    this.player1Id = player1Id;
    this.player2Id = player2Id;
    this.state = 'WAITING';
    this.roundNumber = 0;
    this.hands = { [player1Id]: [], [player2Id]: [] };
    this.originalDeck = null;
    this.deckHash = null;
    this.pendingWarCards = { [player1Id]: [], [player2Id]: [] };
    this.isWar = false;
  }

  setup() {
    const deck = createDeck();
    const shuffled = shuffle(deck);
    this.originalDeck = shuffled;
    this.deckHash = hashDeck(shuffled);
    const { player1Hand, player2Hand } = dealCards(shuffled);
    this.hands[this.player1Id] = player1Hand;
    this.hands[this.player2Id] = player2Hand;
    this.state = 'ACTIVE';
    return { deckHash: this.deckHash };
  }

  getCardCounts() {
    return {
      [this.player1Id]: this.hands[this.player1Id].length,
      [this.player2Id]: this.hands[this.player2Id].length,
    };
  }

  flipCards() {
    if (this.state !== 'ACTIVE' && this.state !== 'WAR') {
      throw new Error(`Cannot flip in state: ${this.state}`);
    }
    if (this.roundNumber >= MAX_ROUNDS) {
      return this._resolveByCount();
    }

    this.roundNumber++;

    const p1Card = this.hands[this.player1Id].shift();
    const p2Card = this.hands[this.player2Id].shift();

    if (!p1Card || !p2Card) {
      return this._resolveByCount();
    }

    const result = {
      roundNumber: this.roundNumber,
      player1Card: p1Card,
      player2Card: p2Card,
      isWar: false,
      winner: null,
      gameOver: false,
    };

    if (p1Card.rank > p2Card.rank) {
      const winnings = [p1Card, p2Card, ...this.pendingWarCards[this.player1Id], ...this.pendingWarCards[this.player2Id]];
      this.hands[this.player1Id].push(...winnings);
      this.pendingWarCards[this.player1Id] = [];
      this.pendingWarCards[this.player2Id] = [];
      result.winner = this.player1Id;
      this.state = 'RESOLVED';
    } else if (p2Card.rank > p1Card.rank) {
      const winnings = [p1Card, p2Card, ...this.pendingWarCards[this.player1Id], ...this.pendingWarCards[this.player2Id]];
      this.hands[this.player2Id].push(...winnings);
      this.pendingWarCards[this.player1Id] = [];
      this.pendingWarCards[this.player2Id] = [];
      result.winner = this.player2Id;
      this.state = 'RESOLVED';
    } else {
      result.isWar = true;
      this.state = 'WAR';
      this.pendingWarCards[this.player1Id].push(p1Card);
      this.pendingWarCards[this.player2Id].push(p2Card);
    }

    if (result.winner) {
      const gameOver = this._checkGameOver();
      if (gameOver) {
        result.gameOver = true;
        result.gameWinner = gameOver;
        this.state = 'CLOSED';
      } else {
        this.state = 'ACTIVE';
      }
    }

    return result;
  }

  resolveWar() {
    if (this.state !== 'WAR') throw new Error('Not in war state');

    const p1 = this.hands[this.player1Id];
    const p2 = this.hands[this.player2Id];

    if (p1.length === 0) {
      this.state = 'CLOSED';
      return { gameOver: true, gameWinner: this.player2Id, reason: 'no_cards_for_war' };
    }
    if (p2.length === 0) {
      this.state = 'CLOSED';
      return { gameOver: true, gameWinner: this.player1Id, reason: 'no_cards_for_war' };
    }

    const p1FaceDown = p1.shift();
    const p2FaceDown = p2.shift();
    this.pendingWarCards[this.player1Id].push(p1FaceDown);
    this.pendingWarCards[this.player2Id].push(p2FaceDown);

    this.state = 'ACTIVE';

    return { faceDownCards: { [this.player1Id]: p1FaceDown, [this.player2Id]: p2FaceDown } };
  }

  _checkGameOver() {
    if (this.hands[this.player1Id].length === 0) return this.player2Id;
    if (this.hands[this.player2Id].length === 0) return this.player1Id;
    return null;
  }

  _resolveByCount() {
    const p1Count = this.hands[this.player1Id].length;
    const p2Count = this.hands[this.player2Id].length;
    const winner = p1Count >= p2Count ? this.player1Id : this.player2Id;
    this.state = 'CLOSED';
    return { gameOver: true, gameWinner: winner, reason: 'timeout_or_max_rounds' };
  }

  serialize() {
    return {
      gameId: this.gameId,
      state: this.state,
      roundNumber: this.roundNumber,
      cardCounts: this.getCardCounts(),
      isWar: this.state === 'WAR',
    };
  }
}

module.exports = { GameEngine };
