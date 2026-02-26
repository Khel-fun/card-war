import crypto from "crypto";

type PoolLike = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

const SESSION_UUID_COLUMNS = new Set(["circuit_uuids", "proof_uuids", "job_ids"]);

export type CircuitSetupPayload = {
  kind: "shuffle" | "deal";
  compiledCircuit: unknown;
  verificationKeyHex: string;
  vkHash: string;
  artifactSha256: string;
};

export type ProofRecordPayload = {
  sessionUuid: string;
  circuitUuid: string;
  playerAddress?: string | null;
  proofHex: string;
  publicInputs: string[];
  bbVerificationStatus: boolean;
};

export type VerificationJobPayload = {
  jobId: string;
  status:
    | "Aggregated"
    | "AggregationPending"
    | "AggregationPublished"
    | "Failed"
    | "Finalized"
    | "IncludedInBlock"
    | "Queued"
    | "Submitted"
    | "Valid";
  aggregationId?: number | null;
  aggregationResponse?: Record<string, unknown> | null;
  leaf?: string | null;
  leafIndex?: number | null;
  numberOfLeaves?: number | null;
  merkleProof?: string[] | null;
  statement?: string | null;
  txHash?: string | null;
};

export type AggregationVerificationPayload = {
  proofUuid: string;
  zkverifyContractAddress: string;
  domainId: number;
  aggregationId: number;
  leaf: string;
  merklePath: string[];
  leafCount: number;
  leafIndex: number;
  verified: boolean;
  txHash?: string | null;
};

export class TrackingRepository {
  constructor(private readonly pool: PoolLike) {}

  static sha256Hex(value: string): string {
    return crypto.createHash("sha256").update(value).digest("hex");
  }

  async upsertGameSession(sessionUuid: string, players: string[] = []) {
    await this.pool.query(
      `
      INSERT INTO game_sessions (session_uuid, players)
      VALUES ($1::uuid, $2::char(42)[])
      ON CONFLICT (session_uuid) DO UPDATE
      SET players = CASE
          WHEN cardinality(COALESCE(game_sessions.players, '{}')) = 0 THEN EXCLUDED.players
          ELSE game_sessions.players
      END
      `,
      [sessionUuid, players.length ? players : []],
    );
  }

  async appendSessionUuid(
    sessionUuid: string,
    column: "circuit_uuids" | "proof_uuids" | "job_ids",
    value: string,
  ) {
    if (!SESSION_UUID_COLUMNS.has(column)) {
      throw new Error(`Invalid session UUID column: ${column}`);
    }
    await this.pool.query(
      `
      UPDATE game_sessions
      SET ${column} = CASE
          WHEN $2::uuid = ANY(COALESCE(${column}, '{}')) THEN COALESCE(${column}, '{}')
          ELSE array_append(COALESCE(${column}, '{}'), $2::uuid)
      END
      WHERE session_uuid = $1::uuid
      `,
      [sessionUuid, value],
    );
  }

  async getActiveCircuit(kind: "shuffle" | "deal") {
    const result = await this.pool.query(
      `
      SELECT circuit_uuid, kind, compiled_circuit, vkey_hex, vk_hash, artifact_sha256
      FROM circuits
      WHERE kind = $1::circuit_kind AND is_active = TRUE
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [kind],
    );
    return result.rows[0] ?? null;
  }

  async upsertCircuitSetup(payload: CircuitSetupPayload) {
    const result = await this.pool.query(
      `
      INSERT INTO circuits (kind, compiled_circuit, vkey_hex, vk_hash, artifact_sha256, is_active)
      VALUES ($1::circuit_kind, $2::jsonb, $3, $4, $5, TRUE)
      ON CONFLICT (kind, artifact_sha256) DO UPDATE
      SET vkey_hex = EXCLUDED.vkey_hex,
          vk_hash = EXCLUDED.vk_hash,
          is_active = TRUE
      RETURNING circuit_uuid, kind, compiled_circuit, vkey_hex, vk_hash, artifact_sha256
      `,
      [
        payload.kind,
        JSON.stringify(payload.compiledCircuit),
        payload.verificationKeyHex,
        payload.vkHash,
        payload.artifactSha256,
      ],
    );
    return result.rows[0];
  }

  async createProofRecord(payload: ProofRecordPayload) {
    const normalizedInputs = payload.publicInputs.map((input) =>
      input.startsWith("0x") ? input : `0x${input}`,
    );
    const proofHexHash = TrackingRepository.sha256Hex(payload.proofHex);
    const publicInputsHash = TrackingRepository.sha256Hex(
      JSON.stringify(normalizedInputs),
    );

    const result = await this.pool.query(
      `
      INSERT INTO proofs (
        session_uuid,
        circuit_uuid,
        player_address,
        proof_hex,
        proof_hex_hash,
        public_inputs,
        public_inputs_hash,
        bb_verification_status
      )
      VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::text[], $7, $8)
      RETURNING proof_uuid
      `,
      [
        payload.sessionUuid,
        payload.circuitUuid,
        payload.playerAddress ?? null,
        payload.proofHex,
        proofHexHash,
        normalizedInputs,
        publicInputsHash,
        payload.bbVerificationStatus,
      ],
    );
    return result.rows[0]?.proof_uuid;
  }

  async attachProofSubmission(
    proofUuid: string,
    jobId: string,
    proofPayload: Record<string, unknown>,
    submitResponse: Record<string, unknown>,
  ) {
    await this.pool.query(
      `
      UPDATE proofs
      SET job_id = $2::uuid,
          proof_payload_json = $3::jsonb,
          submit_response_json = $4::jsonb,
          updated_at = NOW()
      WHERE proof_uuid = $1::uuid
      `,
      [proofUuid, jobId, JSON.stringify(proofPayload), JSON.stringify(submitResponse)],
    );
  }

  async upsertVerificationJob(payload: VerificationJobPayload) {
    await this.pool.query(
      `
      INSERT INTO verification_jobs (
        job_id, status, aggregation_id, aggregation_response,
        leaf, leaf_index, number_of_leaves, merkle_proof, statement, tx_hash, updated_at
      )
      VALUES (
        $1::uuid, $2::job_status, $3, $4::jsonb,
        $5, $6, $7, $8::text[], $9, $10, NOW()
      )
      ON CONFLICT (job_id) DO UPDATE
      SET status = EXCLUDED.status,
          aggregation_id = EXCLUDED.aggregation_id,
          aggregation_response = EXCLUDED.aggregation_response,
          leaf = EXCLUDED.leaf,
          leaf_index = EXCLUDED.leaf_index,
          number_of_leaves = EXCLUDED.number_of_leaves,
          merkle_proof = EXCLUDED.merkle_proof,
          statement = EXCLUDED.statement,
          tx_hash = EXCLUDED.tx_hash,
          updated_at = NOW()
      `,
      [
        payload.jobId,
        payload.status,
        payload.aggregationId ?? null,
        payload.aggregationResponse ? JSON.stringify(payload.aggregationResponse) : null,
        payload.leaf ?? null,
        payload.leafIndex ?? null,
        payload.numberOfLeaves ?? null,
        payload.merkleProof ?? null,
        payload.statement ?? null,
        payload.txHash ?? null,
      ],
    );
  }

  async setProofOnchainVerificationStatus(
    proofUuid: string,
    verified: boolean | null,
  ) {
    await this.pool.query(
      `
      UPDATE proofs
      SET onchain_verification_status = $2,
          updated_at = NOW()
      WHERE proof_uuid = $1::uuid
      `,
      [proofUuid, verified],
    );
  }

  async insertAggregationVerification(payload: AggregationVerificationPayload) {
    await this.pool.query(
      `
      INSERT INTO aggregation_verifications (
        proof_uuid,
        zkverify_contract_address,
        domain_id,
        aggregation_id,
        leaf,
        merkle_path,
        leaf_count,
        leaf_index,
        verified,
        tx_hash
      )
      VALUES (
        $1::uuid,
        $2,
        $3,
        $4,
        $5,
        $6::text[],
        $7,
        $8,
        $9,
        $10
      )
      `,
      [
        payload.proofUuid,
        payload.zkverifyContractAddress,
        payload.domainId,
        payload.aggregationId,
        payload.leaf,
        payload.merklePath,
        payload.leafCount,
        payload.leafIndex,
        payload.verified,
        payload.txHash ?? null,
      ],
    );
  }
}
