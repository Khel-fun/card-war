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
  },
});

app.use(cors({ origin: '*' }));
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
    const sessionResult = await pool.query(
      `SELECT session_uuid, COALESCE(cardinality(job_ids), 0) AS expected_jobs
       FROM game_sessions
       WHERE session_uuid = $1::uuid`,
      [gameId]
    );
    if (!sessionResult.rows.length) {
      return res.status(404).json({ error: 'Game session not found' });
    }

    const expectedJobs = Number(sessionResult.rows[0].expected_jobs) || 0;
    const proofsResult = await pool.query(
      `SELECT
         bb_verification_status,
         LOWER(COALESCE(submit_response_json->>'optimisticVerify', '')) AS optimistic_verify,
         updated_at
       FROM proofs
       WHERE session_uuid = $1::uuid`,
      [gameId]
    );

    const proofs = proofsResult.rows;
    const observedProofs = proofs.length;
    const targetCount = expectedJobs > 0 ? expectedJobs : observedProofs;

    const bbTrueCount = proofs.filter((p) => p.bb_verification_status === true).length;
    const bbFalseCount = proofs.filter((p) => p.bb_verification_status === false).length;

    const optimisticSuccessCount = proofs.filter(
      (p) => p.optimistic_verify === 'success'
    ).length;
    const optimisticFailedCount = proofs.filter(
      (p) => p.optimistic_verify === 'failed'
    ).length;

    const resolveStatus = (successCount, failedCount) => {
      if (targetCount <= 0 || observedProofs < targetCount) return 'pending';
      if (failedCount > 0) return 'failed';
      if (successCount === targetCount) return 'passed';
      return 'pending';
    };

    const bbStatus = resolveStatus(bbTrueCount, bbFalseCount);
    const optimisticStatus = resolveStatus(
      optimisticSuccessCount,
      optimisticFailedCount
    );

    const lastUpdatedAt = proofs.reduce((latest, row) => {
      const ts = row.updated_at ? new Date(row.updated_at).toISOString() : null;
      if (!ts) return latest;
      if (!latest) return ts;
      return ts > latest ? ts : latest;
    }, null);

    return res.json({
      gameId,
      expectedProofs: targetCount,
      observedProofs,
      checks: {
        bbjs: {
          status: bbStatus,
          passedCount: bbTrueCount,
          failedCount: bbFalseCount,
          expectedCount: targetCount,
        },
        optimisticVerify: {
          status: optimisticStatus,
          passedCount: optimisticSuccessCount,
          failedCount: optimisticFailedCount,
          expectedCount: targetCount,
        },
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
