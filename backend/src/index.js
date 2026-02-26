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
    origin: process.env.CLIENT_URL || 'http://localhost:3000',
    methods: ['GET', 'POST'],
  },
});

app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:3000' }));
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

setupSocketHandlers(io);

const PORT = process.env.PORT || 4000;
initDB()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database schema:', err);
    process.exit(1);
  });
