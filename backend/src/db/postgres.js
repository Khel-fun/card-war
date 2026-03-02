const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/cardwar',
});

async function initDB() {
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'circuit_kind') THEN
        CREATE TYPE circuit_kind AS ENUM ('shuffle', 'deal');
      END IF;
    END $$;

    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_status') THEN
        CREATE TYPE job_status AS ENUM (
          'Aggregated',
          'AggregationPending',
          'AggregationPublished',
          'Failed',
          'Finalized',
          'IncludedInBlock',
          'Queued',
          'Submitted',
          'Valid'
        );
      END IF;
    END $$;

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

    CREATE TABLE IF NOT EXISTS game_sessions (
      session_uuid UUID PRIMARY KEY,
      circuit_uuids UUID[] DEFAULT '{}',
      proof_uuids UUID[] DEFAULT '{}',
      job_ids UUID[] DEFAULT '{}',
      players CHAR(42)[] DEFAULT '{}',
      score NUMERIC[] DEFAULT '{}',
      winner CHAR(42)[] DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      ended_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS circuits (
      circuit_uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      kind circuit_kind NOT NULL,
      compiled_circuit JSONB NOT NULL,
      vkey_hex TEXT NOT NULL,
      vk_hash CHAR(66) NOT NULL,
      artifact_sha256 TEXT NOT NULL,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (kind, artifact_sha256)
    );

    CREATE TABLE IF NOT EXISTS verification_jobs (
      job_id UUID PRIMARY KEY,
      status job_status NOT NULL,
      aggregation_id BIGINT,
      aggregation_response JSONB,
      leaf TEXT,
      leaf_index INTEGER,
      number_of_leaves INTEGER,
      merkle_proof TEXT[],
      statement TEXT,
      tx_hash TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS proofs (
      proof_uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      session_uuid UUID REFERENCES game_sessions(session_uuid) ON DELETE SET NULL,
      circuit_uuid UUID REFERENCES circuits(circuit_uuid),
      player_address CHAR(42),
      proof_hex TEXT NOT NULL,
      proof_hex_hash TEXT NOT NULL,
      public_inputs TEXT[] NOT NULL,
      public_inputs_hash TEXT NOT NULL,
      bb_verification_status BOOLEAN,
      job_id UUID REFERENCES verification_jobs(job_id),
      onchain_verification_status BOOLEAN,
      proof_payload_json JSONB,
      submit_response_json JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS aggregation_verifications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      proof_uuid UUID NOT NULL REFERENCES proofs(proof_uuid) ON DELETE CASCADE,
      zkverify_contract_address TEXT NOT NULL,
      domain_id BIGINT NOT NULL,
      aggregation_id BIGINT NOT NULL,
      leaf TEXT NOT NULL,
      merkle_path TEXT[] NOT NULL,
      leaf_count BIGINT NOT NULL,
      leaf_index BIGINT NOT NULL,
      verified BOOLEAN,
      tx_hash TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_circuits_kind_active ON circuits(kind, is_active);
    CREATE INDEX IF NOT EXISTS idx_proofs_session_uuid ON proofs(session_uuid);
    CREATE INDEX IF NOT EXISTS idx_proofs_job_id ON proofs(job_id);
    CREATE INDEX IF NOT EXISTS idx_verification_jobs_status ON verification_jobs(status);
    CREATE INDEX IF NOT EXISTS idx_verification_jobs_aggregation_id ON verification_jobs(aggregation_id);
    CREATE INDEX IF NOT EXISTS idx_aggregation_verifications_domain_agg
      ON aggregation_verifications(domain_id, aggregation_id);
  `);
  console.log('Database initialized');
}

module.exports = { pool, initDB };
