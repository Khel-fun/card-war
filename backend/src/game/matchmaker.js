const { v4: uuidv4 } = require('uuid');
const { GameEngine } = require('./gameEngine');

class Matchmaker {
  constructor() {
    this.waitingPlayers = [];
    this.games = new Map();
    this.playerToGame = new Map();
  }

  addPlayer(playerId, socketId, walletAddress) {
    if (this.playerToGame.has(playerId)) {
      return { type: 'already_in_game', gameId: this.playerToGame.get(playerId) };
    }

    const existing = this.waitingPlayers.find(p => p.playerId === playerId);
    if (existing) {
      existing.socketId = socketId;
      return { type: 'waiting' };
    }

    if (this.waitingPlayers.length > 0) {
      const opponent = this.waitingPlayers.shift();
      const gameId = uuidv4();
      const engine = new GameEngine(gameId, opponent.playerId, playerId);
      engine.setup();

      const game = {
        gameId,
        engine,
        players: {
          [opponent.playerId]: { socketId: opponent.socketId, walletAddress: opponent.walletAddress },
          [playerId]: { socketId, walletAddress },
        },
        readyFlips: new Set(),
      };

      this.games.set(gameId, game);
      this.playerToGame.set(opponent.playerId, gameId);
      this.playerToGame.set(playerId, gameId);

      return {
        type: 'game_start',
        gameId,
        opponent: { playerId: opponent.playerId, walletAddress: opponent.walletAddress },
        self: { playerId, walletAddress },
        player1Id: opponent.playerId,
        player2Id: playerId,
      };
    }

    this.waitingPlayers.push({ playerId, socketId, walletAddress });
    return { type: 'waiting' };
  }

  removePlayer(playerId) {
    this.waitingPlayers = this.waitingPlayers.filter(p => p.playerId !== playerId);
    const gameId = this.playerToGame.get(playerId);
    if (gameId) {
      const game = this.games.get(gameId);
      if (game) {
        const opponentId = Object.keys(game.players).find(id => id !== playerId);
        this.playerToGame.delete(playerId);
        this.playerToGame.delete(opponentId);
        this.games.delete(gameId);
        return { gameId, opponentId, opponentSocketId: game.players[opponentId]?.socketId };
      }
    }
    return null;
  }

  getGame(gameId) {
    return this.games.get(gameId);
  }

  getGameByPlayer(playerId) {
    const gameId = this.playerToGame.get(playerId);
    return gameId ? this.games.get(gameId) : null;
  }

  endGame(gameId) {
    const game = this.games.get(gameId);
    if (game) {
      for (const playerId of Object.keys(game.players)) {
        this.playerToGame.delete(playerId);
      }
      this.games.delete(gameId);
    }
  }
}

module.exports = { Matchmaker };
