const { v4: uuidv4 } = require('uuid');
const { Matchmaker } = require('../game/matchmaker');
const { pool } = require('../db/postgres');

const matchmaker = new Matchmaker();

function setupSocketHandlers(io) {
  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    socket.on('join_queue', async ({ walletAddress }) => {
      if (!walletAddress) {
        socket.emit('error', { message: 'walletAddress required' });
        return;
      }

      const playerId = walletAddress.toLowerCase();
      const joinTimestamp = Date.now();

      try {
        await pool.query(
          `INSERT INTO users (id, wallet_address) VALUES ($1, $2)
           ON CONFLICT (wallet_address) DO NOTHING`,
          [uuidv4(), walletAddress.toLowerCase()]
        );
      } catch (err) {
        console.error('DB upsert error:', err.message);
      }

      socket.data.playerId = playerId;
      socket.data.walletAddress = walletAddress;

      let result;
      try {
        result = await matchmaker.addPlayer(playerId, socket.id, walletAddress, joinTimestamp);
      } catch (err) {
        console.error('Matchmaker error:', err.message);
        socket.emit('error', { message: 'Failed to join game. Please try again.' });
        return;
      }

      if (result.type === 'waiting') {
        socket.emit('queue_joined', { message: 'Waiting for opponent...' });
      } else if (result.type === 'already_in_game') {
        socket.emit('error', { message: 'Already in a game', gameId: result.gameId });
      } else if (result.type === 'game_start') {
        const { gameId, player1Id, player2Id, opponent, self } = result;
        const game = matchmaker.getGame(gameId);

        try {
          const p1Row = await pool.query('SELECT id FROM users WHERE wallet_address = $1', [player1Id]);
          const p2Row = await pool.query('SELECT id FROM users WHERE wallet_address = $1', [player2Id]);
          const p1DbId = p1Row.rows[0]?.id;
          const p2DbId = p2Row.rows[0]?.id;

          await pool.query(
            `INSERT INTO games (id, player1_id, player2_id, status, original_deck)
             VALUES ($1, $2, $3, 'ACTIVE', $4)`,
            [gameId, p1DbId, p2DbId, JSON.stringify(game.engine.originalDeck)]
          );

          await pool.query(
            `INSERT INTO game_sessions (session_uuid, players)
             VALUES ($1::uuid, $2::char(42)[])
             ON CONFLICT (session_uuid) DO UPDATE
             SET players = EXCLUDED.players`,
            [gameId, [player1Id, player2Id]]
          );
        } catch (err) {
          console.error('DB game insert error:', err.message);
        }

        socket.join(gameId);
        const opponentSocket = getSocketByPlayerId(io, player1Id);
        if (opponentSocket) opponentSocket.join(gameId);

        const gameState = game.engine.serialize();

        io.to(gameId).emit('game_start', {
          gameId,
          player1Id,
          player2Id,
          cardCounts: gameState.cardCounts,
        });

        socket.emit('your_role', { playerId: self.playerId, role: 'player2' });
        if (opponentSocket) {
          opponentSocket.emit('your_role', { playerId: opponent.playerId, role: 'player1' });
        }
      }
    });

    socket.on('flip_card', async ({ gameId }) => {
      const playerId = socket.data.playerId;
      if (!playerId) return;

      const game = matchmaker.getGame(gameId);
      if (!game) {
        socket.emit('error', { message: 'Game not found' });
        return;
      }

      if (!game.players[playerId]) {
        socket.emit('error', { message: 'Not a player in this game' });
        return;
      }

      game.readyFlips.add(playerId);

      if (game.readyFlips.size < 2) {
        io.to(gameId).emit('player_ready', { playerId, waiting: true });
        return;
      }

      game.readyFlips.clear();

      try {
        const result = game.engine.flipCards();

        io.to(gameId).emit('card_flip', {
          roundNumber: result.roundNumber,
          player1Card: result.player1Card,
          player2Card: result.player2Card,
          isWar: result.isWar,
          winner: result.winner,
          cardCounts: game.engine.getCardCounts(),
        });

        if (result.isWar) {
          io.to(gameId).emit('war_start', { message: 'WAR! Both players flip a face-down card.' });
        }

        if (result.gameOver) {
          await handleGameOver(io, game, result.gameWinner, gameId);
        } else {
          try {
            const p1Row = await pool.query('SELECT id FROM users WHERE wallet_address = $1', [game.engine.player1Id]);
            const p2Row = await pool.query('SELECT id FROM users WHERE wallet_address = $1', [game.engine.player2Id]);
            await pool.query(
              `INSERT INTO rounds (id, game_id, round_number, player1_card, player2_card, winner_id, is_war)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [
                uuidv4(), gameId, result.roundNumber,
                JSON.stringify(result.player1Card), JSON.stringify(result.player2Card),
                result.winner ? (result.winner === game.engine.player1Id ? p1Row.rows[0]?.id : p2Row.rows[0]?.id) : null,
                result.isWar,
              ]
            );
          } catch (err) {
            console.error('Round insert error:', err.message);
          }
        }
      } catch (err) {
        socket.emit('error', { message: err.message });
      }
    });

    socket.on('resolve_war', async ({ gameId }) => {
      const playerId = socket.data.playerId;
      const game = matchmaker.getGame(gameId);
      if (!game) return;

      game.readyFlips.add(playerId);
      if (game.readyFlips.size < 2) return;
      game.readyFlips.clear();

      try {
        const warResult = game.engine.resolveWar();

        if (warResult.gameOver) {
          io.to(gameId).emit('war_result', { gameOver: true });
          await handleGameOver(io, game, warResult.gameWinner, gameId);
        } else {
          io.to(gameId).emit('war_face_down', {
            message: 'Face-down cards placed. Now flip!',
            cardCounts: game.engine.getCardCounts(),
          });
        }
      } catch (err) {
        socket.emit('error', { message: err.message });
      }
    });

    socket.on('disconnect', () => {
      const playerId = socket.data.playerId;
      if (!playerId) return;

      const removed = matchmaker.removePlayer(playerId);
      if (removed) {
        const { gameId, opponentSocketId } = removed;
        if (opponentSocketId) {
          io.to(opponentSocketId).emit('opponent_disconnected', {
            message: 'Opponent disconnected. You win!',
            gameId,
          });
        }
        pool.query(
          `UPDATE games SET status = 'CLOSED', ended_at = NOW() WHERE id = $1`,
          [gameId]
        ).catch(console.error);
        pool.query(
          `UPDATE game_sessions SET ended_at = NOW() WHERE session_uuid = $1::uuid`,
          [gameId]
        ).catch(console.error);
      }
    });
  });
}

function getSocketByPlayerId(io, playerId) {
  for (const [, socket] of io.sockets.sockets) {
    if (socket.data.playerId === playerId) return socket;
  }
  return null;
}

async function handleGameOver(io, game, winnerId, gameId) {
  io.to(gameId).emit('game_end', {
    winner: winnerId,
    cardCounts: game.engine.getCardCounts(),
    roundNumber: game.engine.roundNumber,
  });

  try {
    const winnerRow = await pool.query('SELECT id FROM users WHERE wallet_address = $1', [winnerId]);
    await pool.query(
      `UPDATE games SET status = 'CLOSED', winner_id = $1, ended_at = NOW() WHERE id = $2`,
      [winnerRow.rows[0]?.id, gameId]
    );
    await pool.query(
      `UPDATE game_sessions
       SET winner = $1::char(42)[], ended_at = NOW()
       WHERE session_uuid = $2::uuid`,
      [[winnerId], gameId]
    );
  } catch (err) {
    console.error('Game over DB error:', err.message);
  }

  matchmaker.endGame(gameId);
}

module.exports = { setupSocketHandlers };
