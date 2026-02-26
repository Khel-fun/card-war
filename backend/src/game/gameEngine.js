// Lazy-loaded dynamic imports for ESM proving_system modules
// Cached after first call — concurrency-safe since each game gets its own GameEngine instance
let _provingModules = null;
async function getProvingModules() {
  if (!_provingModules) {
    const [proveModule, typeModule, circuitsModule] = await Promise.all([
      import("../proving_system/prove.ts"),
      import("../proving_system/type.ts"),
      import("../proving_system/circuits/index.ts"),
    ]);
    _provingModules = {
      generateProof: proveModule.generateProof,
      verifyProof: proveModule.verifyProof,
      CircuitKind: typeModule.CircuitKind,
      shuffle_deck: circuitsModule.shuffle_deck,
      deal_cards: circuitsModule.deal_cards,
      card_to_string: circuitsModule.card_to_string,
    };
  }
  return _provingModules;
}

const MAX_ROUNDS = 5;
const SUITS = ["hearts", "diamonds", "clubs", "spades"];

class GameEngine {
  constructor(gameId, player1Id, player2Id) {
    this.gameId = gameId;
    this.player1Id = player1Id;
    this.player2Id = player2Id;
    this.state = "WAITING";
    this.roundNumber = 0;
    this.hands = { [player1Id]: [], [player2Id]: [] };
    this.originalDeck = null;
    this.pendingWarCards = { [player1Id]: [], [player2Id]: [] };
    this.isWar = false;
  }

  /**
   * Shuffles and deals cards using ZK circuits, then fires non-blocking proof generation.
   * @param {string} seed_A - String representation of player 1's join timestamp (Field input)
   * @param {string} seed_B - String representation of player 2's join timestamp (Field input)
   * @returns {Promise<{ }>}
   */
  async setup(seed_A, seed_B) {
    const {
      shuffle_deck,
      deal_cards,
      card_to_string,
      generateProof,
      verifyProof,
      CircuitKind,
    } = await getProvingModules();

    // --- Shuffle (in-process Noir witness execution, fast) ---
    const shuffled_deck_A = await shuffle_deck(seed_A);
    const shuffled_deck_B = await shuffle_deck(seed_B);

    // --- Deal (in-process Noir witness execution, fast) ---
    const [dealt_cards_A, dealt_commitment_A] = await deal_cards(
      shuffled_deck_A,
      seed_A,
    );
    const [dealt_cards_B, dealt_commitment_B] = await deal_cards(
      shuffled_deck_B,
      seed_B,
    );

    // --- Convert Field card indices to {rank, suit} objects ---
    const p1Cards = await Promise.all(
      dealt_cards_A.map(async (card) => {
        const [rank, suit] = await card_to_string(card);
        return { rank: Number(rank), suit: SUITS[Number(suit)] };
      }),
    );
    const p2Cards = await Promise.all(
      dealt_cards_B.map(async (card) => {
        const [rank, suit] = await card_to_string(card);
        return { rank: Number(rank), suit: SUITS[Number(suit)] };
      }),
    );

    // --- Populate game state ---
    this.hands[this.player1Id] = p1Cards;
    this.hands[this.player2Id] = p2Cards;
    this.originalDeck = [...shuffled_deck_A];
    this.state = "ACTIVE";

    // --- Fire-and-forget proof generation (non-blocking) ---
    this._generateAndVerifyProofsBackground(
      seed_A,
      seed_B,
      shuffled_deck_A,
      shuffled_deck_B,
      dealt_cards_A,
      dealt_commitment_A,
      dealt_cards_B,
      dealt_commitment_B,
      generateProof,
      verifyProof,
      CircuitKind,
    );

    return {};
  }

  /**
   * Generates ZK proofs for shuffle and deal in the background.
   * Does NOT block gameplay. Errors are logged but do not affect the game.
   * @private
   */
  _generateAndVerifyProofsBackground(
    seed_A,
    seed_B,
    shuffled_deck_A,
    shuffled_deck_B,
    dealt_cards_A,
    dealt_commitment_A,
    dealt_cards_B,
    dealt_commitment_B,
    generateProof,
    verifyProof,
    CircuitKind,
  ) {
    const gameId = this.gameId;

    Promise.all([
      generateProof(CircuitKind.SHUFFLE, {
        seed: seed_A,
        shuffled_deck: shuffled_deck_A,
      }),
      generateProof(CircuitKind.SHUFFLE, {
        seed: seed_B,
        shuffled_deck: shuffled_deck_B,
      }),
      generateProof(CircuitKind.DEAL, {
        seed: seed_A,
        commitment: dealt_commitment_A,
        cards: dealt_cards_A,
      }),
      generateProof(CircuitKind.DEAL, {
        seed: seed_B,
        commitment: dealt_commitment_B,
        cards: dealt_cards_B,
      }),
    ])
      .then(([shuffleA, shuffleB, dealA, dealB]) => {
        // Each element is { proofHex: string, publicInputs: string[] }
        // publicInputs already normalized with 0x prefix
        console.log("[ZK] All proofs generated successfully for game", gameId);
        return Promise.all([
          verifyProof(
            CircuitKind.SHUFFLE,
            shuffleA.proofHex,
            shuffleA.publicInputs,
          ),
          verifyProof(
            CircuitKind.SHUFFLE,
            shuffleB.proofHex,
            shuffleB.publicInputs,
          ),
          verifyProof(CircuitKind.DEAL, dealA.proofHex, dealA.publicInputs),
          verifyProof(CircuitKind.DEAL, dealB.proofHex, dealB.publicInputs),
        ]);
      })
      .then(() => {
        console.log(`[ZK] All proofs verified successfully for game ${gameId}`);
      })
      .catch((err) => {
        console.error(`[ZK] Proof processes failed for game ${gameId}:`, err);
      });
  }

  getCardCounts() {
    return {
      [this.player1Id]: this.hands[this.player1Id].length,
      [this.player2Id]: this.hands[this.player2Id].length,
    };
  }

  flipCards() {
    if (this.state !== "ACTIVE" && this.state !== "WAR") {
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
      const winnings = [
        p1Card,
        p2Card,
        ...this.pendingWarCards[this.player1Id],
        ...this.pendingWarCards[this.player2Id],
      ];
      this.hands[this.player1Id].push(...winnings);
      this.pendingWarCards[this.player1Id] = [];
      this.pendingWarCards[this.player2Id] = [];
      result.winner = this.player1Id;
      this.state = "RESOLVED";
    } else if (p2Card.rank > p1Card.rank) {
      const winnings = [
        p1Card,
        p2Card,
        ...this.pendingWarCards[this.player1Id],
        ...this.pendingWarCards[this.player2Id],
      ];
      this.hands[this.player2Id].push(...winnings);
      this.pendingWarCards[this.player1Id] = [];
      this.pendingWarCards[this.player2Id] = [];
      result.winner = this.player2Id;
      this.state = "RESOLVED";
    } else {
      result.isWar = true;
      this.state = "WAR";
      this.pendingWarCards[this.player1Id].push(p1Card);
      this.pendingWarCards[this.player2Id].push(p2Card);
    }

    if (result.winner) {
      const gameOver = this._checkGameOver();
      if (gameOver) {
        result.gameOver = true;
        result.gameWinner = gameOver;
        this.state = "CLOSED";
      } else {
        this.state = "ACTIVE";
      }
    }

    return result;
  }

  resolveWar() {
    if (this.state !== "WAR") throw new Error("Not in war state");

    const p1 = this.hands[this.player1Id];
    const p2 = this.hands[this.player2Id];

    if (p1.length === 0) {
      this.state = "CLOSED";
      return {
        gameOver: true,
        gameWinner: this.player2Id,
        reason: "no_cards_for_war",
      };
    }
    if (p2.length === 0) {
      this.state = "CLOSED";
      return {
        gameOver: true,
        gameWinner: this.player1Id,
        reason: "no_cards_for_war",
      };
    }

    const p1FaceDown = p1.shift();
    const p2FaceDown = p2.shift();
    this.pendingWarCards[this.player1Id].push(p1FaceDown);
    this.pendingWarCards[this.player2Id].push(p2FaceDown);

    this.state = "ACTIVE";

    return {
      faceDownCards: {
        [this.player1Id]: p1FaceDown,
        [this.player2Id]: p2FaceDown,
      },
    };
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
    this.state = "CLOSED";
    return {
      gameOver: true,
      gameWinner: winner,
      reason: "timeout_or_max_rounds",
    };
  }

  serialize() {
    return {
      gameId: this.gameId,
      state: this.state,
      roundNumber: this.roundNumber,
      cardCounts: this.getCardCounts(),
      isWar: this.state === "WAR",
    };
  }
}

module.exports = { GameEngine };
