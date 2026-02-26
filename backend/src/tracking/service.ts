import { createRequire } from "module";
import { CircuitKind } from "../proving_system/type";
import {
  TrackingRepository,
  VerificationJobPayload,
  AggregationVerificationPayload,
} from "./repository";

const require = createRequire(import.meta.url);
const { pool } = require("../db/postgres.js");

type CircuitSetupInput = {
  kind: CircuitKind;
  compiledCircuit: unknown;
  verificationKeyHex: string;
  vkHash: string;
  artifactSha256: string;
  sessionUuid?: string;
};

type ProofInput = {
  sessionUuid: string;
  circuitUuid: string;
  playerAddress?: string | null;
  proofHex: string;
  publicInputs: string[];
  bbVerificationStatus: boolean;
};

class TrackingService {
  private readonly repository = new TrackingRepository(pool);

  private get enabled() {
    return process.env.TRACKING_ENABLED !== "false";
  }

  async ensureGameSession(sessionUuid: string, players: string[] = []) {
    if (!this.enabled || !sessionUuid) return;
    const normalizedPlayers = players.map((player) => player.toLowerCase());
    await this.repository.upsertGameSession(sessionUuid, normalizedPlayers);
  }

  async getActiveCircuit(kind: CircuitKind) {
    if (!this.enabled) return null;
    return this.repository.getActiveCircuit(kind);
  }

  async upsertCircuitSetup(input: CircuitSetupInput) {
    if (!this.enabled) return null;
    const row = await this.repository.upsertCircuitSetup({
      kind: input.kind,
      compiledCircuit: input.compiledCircuit,
      verificationKeyHex: input.verificationKeyHex,
      vkHash: input.vkHash,
      artifactSha256: input.artifactSha256,
    });
    if (input.sessionUuid) {
      await this.repository.appendSessionUuid(
        input.sessionUuid,
        "circuit_uuids",
        row.circuit_uuid,
      );
    }
    return row;
  }

  async createProofRecord(input: ProofInput) {
    if (!this.enabled) return null;
    await this.repository.upsertGameSession(input.sessionUuid);
    const proofUuid = await this.repository.createProofRecord(input);
    if (proofUuid) {
      await this.repository.appendSessionUuid(
        input.sessionUuid,
        "proof_uuids",
        proofUuid,
      );
    }
    return proofUuid;
  }

  async attachProofSubmission(
    sessionUuid: string,
    proofUuid: string,
    jobId: string,
    proofPayload: Record<string, unknown>,
    submitResponse: Record<string, unknown>,
  ) {
    if (!this.enabled) return;
    await this.repository.attachProofSubmission(
      proofUuid,
      jobId,
      proofPayload,
      submitResponse,
    );
    await this.repository.appendSessionUuid(sessionUuid, "job_ids", jobId);
  }

  async upsertVerificationJob(payload: VerificationJobPayload) {
    if (!this.enabled) return;
    await this.repository.upsertVerificationJob(payload);
  }

  async setProofOnchainVerificationStatus(
    proofUuid: string,
    verified: boolean | null,
  ) {
    if (!this.enabled || !proofUuid) return;
    await this.repository.setProofOnchainVerificationStatus(proofUuid, verified);
  }

  async recordAggregationVerification(payload: AggregationVerificationPayload) {
    if (!this.enabled) return;
    await this.repository.insertAggregationVerification(payload);
  }
}

export const trackingService = new TrackingService();
