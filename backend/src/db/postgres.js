const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/cardwar',
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      wallet_address VARCHAR(42) UNIQUE NOT NULL,
      balance NUMERIC(20, 8) DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS games (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      player1_id UUID REFERENCES users(id),
      player2_id UUID REFERENCES users(id),
      status VARCHAR(20) DEFAULT 'WAITING',
      winner_id UUID REFERENCES users(id),
      deck_hash VARCHAR(64),
      original_deck JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      ended_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS rounds (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      game_id UUID REFERENCES games(id),
      round_number INTEGER NOT NULL,
      player1_card JSONB,
      player2_card JSONB,
      winner_id UUID REFERENCES users(id),
      is_war BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log('Database initialized');
}

module.exports = { pool, initDB };
