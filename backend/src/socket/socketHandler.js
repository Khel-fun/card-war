const { v4: uuidv4 } = require('uuid');
const { Matchmaker } = require('../game/matchmaker');
const { pool } = require('../db/postgres');

const matchmaker = new Matchmaker();
let _verifySessionAggregationsOnChain = null;
const _sessionVerifyRetryTimers = new Map();
const SESSION_VERIFY_RETRY_INTERVAL_MS = Number(process.env.ZK_SESSION_VERIFY_RETRY_INTERVAL_MS || 30000);
const SESSION_VERIFY_MAX_ATTEMPTS = Number(process.env.ZK_SESSION_VERIFY_MAX_ATTEMPTS || 20);

async function getSessionAggregationVerifier() {
  if (!_verifySessionAggregationsOnChain) {
    const proveModule = await import('../proving_system/prove.ts');
    const prove = proveModule.default || proveModule;
    _verifySessionAggregationsOnChain = prove.verifySessionAggregationsOnChain;
  }
  return _verifySessionAggregationsOnChain;
}

function stopSessionVerificationRetry(gameId) {
  const timer = _sessionVerifyRetryTimers.get(gameId);
  if (timer) {
    clearInterval(timer);
    _sessionVerifyRetryTimers.delete(gameId);
  }
}

async function runSessionVerificationAttempt(gameId) {
  const verifySessionAggregationsOnChain = await getSessionAggregationVerifier();
  const summary = await verifySessionAggregationsOnChain(gameId);
  const unresolved =
    summary.skippedNotAggregated + summary.skippedMissingData;
  return { summary, unresolved };
}

function startSessionVerificationRetry(gameId) {
  if (_sessionVerifyRetryTimers.has(gameId)) return;

  let attempts = 0;
  const tick = async () => {
    attempts += 1;
    try {
      const { summary, unresolved } = await runSessionVerificationAttempt(gameId);
      if (unresolved === 0) {
        stopSessionVerificationRetry(gameId);
        console.log(
          `[ZK: SESSION] retry worker completed for game ${gameId} after ${attempts} attempt(s)`,
        );
        return;
      }
      if (attempts >= SESSION_VERIFY_MAX_ATTEMPTS) {
        stopSessionVerificationRetry(gameId);
        console.warn(
          `[ZK: SESSION] retry worker reached max attempts for game ${gameId}; unresolved jobs: ${unresolved}`,
          summary,
        );
      }
    } catch (err) {
      if (attempts >= SESSION_VERIFY_MAX_ATTEMPTS) {
        stopSessionVerificationRetry(gameId);
        console.error(
          `[ZK: SESSION] retry worker failed and stopped for game ${gameId}:`,
          err?.message || err,
        );
      } else {
        console.warn(
          `[ZK: SESSION] retry worker attempt ${attempts} failed for game ${gameId}:`,
          err?.message || err,
        );
      }
    }
  };

  tick().catch((err) => {
    console.error(`[ZK: SESSION] initial retry tick failed for game ${gameId}:`, err?.message || err);
  });

  const timer = setInterval(() => {
    tick().catch((err) => {
      console.error(`[ZK: SESSION] retry tick failed for game ${gameId}:`, err?.message || err);
    });
  }, SESSION_VERIFY_RETRY_INTERVAL_MS);
  _sessionVerifyRetryTimers.set(gameId, timer);
}

function setupSocketHandlers(io) {
  io.on('connection', (socket) => {
    console.log(`[SOCKET] Client connected: ${socket.id}`);
    console.log(`Socket connected: ${socket.id}`);

    socket.on('join_queue', async ({ walletAddress }) => {
      console.log(`[SOCKET] join_queue - walletAddress: ${walletAddress}, socketId: ${socket.id}`);
      if (!walletAddress) {
        socket.emit('error', { message: 'walletAddress required' });
        console.log(`[SOCKET] join_queue - error: walletAddress required, socketId: ${socket.id}`);
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
        console.log(`[SOCKET] join_queue - DB upsert error: ${err.message}, socketId: ${socket.id}`);
      }

      socket.data.playerId = playerId;
      socket.data.walletAddress = walletAddress;

      let result;
      try {
        result = await matchmaker.addPlayer(playerId, socket.id, walletAddress, joinTimestamp);
      } catch (err) {
        console.error('Matchmaker error:', err.message);
        console.log(`[SOCKET] join_queue - Matchmaker error: ${err.message}, socketId: ${socket.id}`);
        socket.emit('error', { message: 'Failed to join game. Please try again.' });
        return;
      }

      if (result.type === 'waiting') {
        socket.emit('queue_joined', { message: 'Waiting for opponent...' });
        console.log(`[SOCKET] join_queue - queue_joined, socketId: ${socket.id}`);
      } else if (result.type === 'already_in_game') {
        socket.emit('error', { message: 'Already in a game', gameId: result.gameId });
        console.log(`[SOCKET] join_queue - already_in_game, gameId: ${result.gameId}, socketId: ${socket.id}`);
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
          console.log(`[SOCKET] join_queue - DB game insert error: ${err.message}, socketId: ${socket.id}`);
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
        console.log(`[SOCKET] join_queue - game_start, gameId: ${gameId}, socketId: ${socket.id}`);

        socket.emit('your_role', { playerId: self.playerId, role: 'player2' });
        console.log(`[SOCKET] join_queue - your_role, playerId: ${self.playerId}, role: player2, socketId: ${socket.id}`);
        if (opponentSocket) {
          opponentSocket.emit('your_role', { playerId: opponent.playerId, role: 'player1' });
          console.log(`[SOCKET] join_queue - your_role, playerId: ${opponent.playerId}, role: player1, socketId: ${opponentSocket.id}`);
        }
      }
    });

    socket.on('flip_card', async ({ gameId }) => {
      console.log(`[SOCKET] flip_card - gameId: ${gameId}, socketId: ${socket.id}`);
      const playerId = socket.data.playerId;
      if (!playerId) return;

      const game = matchmaker.getGame(gameId);
      if (!game) {
        socket.emit('error', { message: 'Game not found' });
        console.log(`[SOCKET] flip_card - error: Game not found, socketId: ${socket.id}`);
        return;
      }

      if (!game.players[playerId]) {
        socket.emit('error', { message: 'Not a player in this game' });
        console.log(`[SOCKET] flip_card - error: Not a player in this game, socketId: ${socket.id}`);
        return;
      }

      game.readyFlips.add(playerId);

      if (game.readyFlips.size < 2) {
        io.to(gameId).emit('player_ready', { playerId, waiting: true });
        console.log(`[SOCKET] flip_card - player_ready, playerId: ${playerId}, waiting: true, socketId: ${socket.id}`);
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
        console.log(`[SOCKET] flip_card - card_flip, gameId: ${gameId}, socketId: ${socket.id}`);

        if (result.isWar) {
          io.to(gameId).emit('war_start', { message: 'WAR! Both players flip a face-down card.' });
          console.log(`[SOCKET] flip_card - war_start, gameId: ${gameId}, socketId: ${socket.id}`);
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
            console.log(`[SOCKET] flip_card - Round insert error: ${err.message}, socketId: ${socket.id}`);
          }
        }
      } catch (err) {
        socket.emit('error', { message: err.message });
        console.log(`[SOCKET] flip_card - error: ${err.message}, socketId: ${socket.id}`);
      }
    });

    socket.on('resolve_war', async ({ gameId }) => {
      console.log(`[SOCKET] resolve_war - gameId: ${gameId}, socketId: ${socket.id}`);
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
          console.log(`[SOCKET] resolve_war - war_result, gameOver: true, gameId: ${gameId}, socketId: ${socket.id}`);
          await handleGameOver(io, game, warResult.gameWinner, gameId);
        } else {
          io.to(gameId).emit('war_face_down', {
            message: 'Face-down cards placed. Now flip!',
            cardCounts: game.engine.getCardCounts(),
          });
          console.log(`[SOCKET] resolve_war - war_face_down, gameId: ${gameId}, socketId: ${socket.id}`);
        }
      } catch (err) {
        socket.emit('error', { message: err.message });
        console.log(`[SOCKET] resolve_war - error: ${err.message}, socketId: ${socket.id}`);
      }
    });

    socket.on('disconnect', () => {
      console.log(`[SOCKET] Client disconnected: ${socket.id}`);
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

  try {
    startSessionVerificationRetry(gameId);
  } catch (err) {
    console.error(`[ZK: SESSION] could not initialize game-end verifier for game ${gameId}:`, err?.message || err);
  }

  matchmaker.endGame(gameId);
}

module.exports = { setupSocketHandlers };
