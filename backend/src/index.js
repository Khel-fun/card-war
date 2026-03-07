require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const { setupSocketHandlers } = require('./socket/socketHandler');
const { pool, initDB } = require('./db/postgres');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true,
    allowedHeaders: ['ngrok-skip-browser-warning', 'content-type'],
  },
});

app.use(cors({ 
  origin: '*',
  credentials: true,
  allowedHeaders: ['ngrok-skip-browser-warning', 'content-type'],
}));
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.get('/api/games/:gameId/reveal', async (req, res) => {
  try {
    const { gameId } = req.params;
    const result = await pool.query(
      'SELECT original_deck, status FROM games WHERE id = $1',
      [gameId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Game not found' });
    if (result.rows[0].status !== 'CLOSED') {
      return res.status(400).json({ error: 'Game not finished yet' });
    }
    res.json({ deck: result.rows[0].original_deck });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/games/:gameId/fairness', async (req, res) => {
  try {
    const { gameId } = req.params;
    const sessionExists = await pool.query(
      `SELECT 1 FROM game_sessions WHERE session_uuid = $1::uuid LIMIT 1`,
      [gameId]
    );
    if (!sessionExists.rows.length) {
      return res.status(404).json({ error: 'Game session not found' });
    }

    const proofsResult = await pool.query(
      `SELECT
         c.kind,
         bb_verification_status,
         LOWER(COALESCE(submit_response_json->>'optimisticVerify', '')) AS optimistic_verify,
         updated_at
       FROM proofs
       LEFT JOIN circuits c ON c.circuit_uuid = proofs.circuit_uuid
       WHERE session_uuid = $1::uuid`,
      [gameId]
    );

    const proofs = proofsResult.rows;
    const byKind = {
      shuffle: proofs.filter((p) => p.kind === 'shuffle'),
      deal: proofs.filter((p) => p.kind === 'deal'),
    };

    const expectedPerKind = 2;
    const evaluateKind = (rows) => {
      const bothPassed = rows.filter(
        (r) =>
          r.bb_verification_status === true &&
          r.optimistic_verify === 'success'
      ).length;
      return {
        checked: bothPassed >= expectedPerKind,
        passedCount: bothPassed,
        expectedCount: expectedPerKind,
      };
    };

    const shuffle = evaluateKind(byKind.shuffle);
    const deal = evaluateKind(byKind.deal);

    const lastUpdatedAt = proofs.reduce((latest, row) => {
      const ts = row.updated_at ? new Date(row.updated_at).toISOString() : null;
      if (!ts) return latest;
      if (!latest) return ts;
      return ts > latest ? ts : latest;
    }, null);

    return res.json({
      gameId,
      fairness: {
        shuffle,
        deal,
      },
      lastUpdatedAt,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

setupSocketHandlers(io);

const PORT = process.env.PORT || 4000;
initDB()
  .then(async () => {
    try {
      const reconcileModule = await import('./proving_system/reconcileJobs.ts');
      const reconcile = reconcileModule.default || reconcileModule;
      if (typeof reconcile.startJobReconcileWorker === 'function') {
        reconcile.startJobReconcileWorker();
      }
    } catch (err) {
      console.error('Failed to start reconcile worker:', err?.message || err);
    }

    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database schema:', err);
    process.exit(1);
  });
