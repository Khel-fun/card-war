import { CompiledCircuit, Noir } from "@noir-lang/noir_js";
import { UltraHonkBackend } from "@aztec/bb.js";
import { CircuitKind } from "./type";
import {
  extractAbiParameters,
  loadCircuitAbi,
  uint8ArrayToHex,
  validateAbiInput,
} from "./utils";
import fs from "fs";
import path from "path";
import axios from "axios";
import dotenv from "dotenv";
import crypto from "crypto";
import { trackingService } from "../tracking/service";
import { verifyAndRecordAggregationOnChain } from "./onchain";
dotenv.config();

type TrackingContext = {
  gameId?: string;
  playerAddress?: string;
  proofUuid?: string | null;
};

type EnsureCircuitResult = {
  circuitUuid: string | null;
  vkHash: string | null;
  verificationKeyHex: string;
};

type SessionOnChainVerificationSummary = {
  gameId: string;
  totalJobs: number;
  verifiedCount: number;
  failedCount: number;
  skippedAlreadyVerified: number;
  skippedNotAggregated: number;
  skippedMissingData: number;
};

const _circuitSetupCache = new Map<CircuitKind, EnsureCircuitResult>();
const _circuitSetupInFlight = new Map<CircuitKind, Promise<EnsureCircuitResult>>();

function hashString(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizePublicInputs(publicInputs: string[]) {
  return publicInputs.map((pi) => (pi.startsWith("0x") ? pi : `0x${pi}`));
}

async function safeTrack<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (error: any) {
    console.error(`[TRACKING] ${label} failed:`, error?.message || error);
    return null;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// setting up Noir and UltraHonk Backend for specific circuit
export function setupProver(circuit_name: CircuitKind) {
  const PATH_TO_CIRCUIT = path.join(
    __dirname,
    "circuits",
    "target",
    `${circuit_name}.json`,
  );

  if (!fs.existsSync(PATH_TO_CIRCUIT)) {
    throw new Error(`[ERR: Circuits] Circuit file not found`);
  }

  const rawCircuit = fs.readFileSync(PATH_TO_CIRCUIT, "utf8");
  const circuit = JSON.parse(rawCircuit);
  if (!circuit.bytecode) {
    throw new Error(`[ERR: Circuits] Circuit bytecode not found`);
  }

  console.log(`## Setting up Prover for ${circuit_name}`);
  const noir = new Noir(circuit as CompiledCircuit);
  const backend = new UltraHonkBackend(circuit.bytecode);
  return { noir, backend, circuit, artifactSha256: hashString(rawCircuit) };
}

// generating and registering the circuit specific verification key with the zkVerify Kurier relayer
export async function registerVk(
  circuit_name: CircuitKind,
  context: TrackingContext = {},
): Promise<EnsureCircuitResult> {
  const { KURIER_URL, KURIER_API } = process.env;
  if (!KURIER_URL || !KURIER_API) {
    throw new Error("[ERR: Env] Missing environment variables");
  }

  const { backend, circuit, artifactSha256 } = setupProver(circuit_name);
  console.log(`## Generating Verification Key for ${circuit_name}`);
  const verification_key = await backend.getVerificationKey({ keccak: true });

  const verificationKeyHex = uint8ArrayToHex(verification_key);
  const vk_payload = {
    proofType: "ultrahonk",
    proofOptions: {
      variant: "Plain",
    },
    vk: `${verificationKeyHex}`,
  };

  console.log(`## Registering Verification Key at Kurier for ${circuit_name}`);
  let vkHash: string | null = null;
  try {
    const reg_vk_response = await axios.post(
      `${KURIER_URL}/register-vk/${KURIER_API}`,
      vk_payload,
    );
    vkHash = reg_vk_response.data?.vkHash || reg_vk_response.data?.meta?.vkHash;
  } catch (error: any) {
    const isAlreadyRegistered =
      error?.response?.status === 400 &&
      error?.response?.data?.code === "REGISTER_VK_FAILED" &&
      String(error?.response?.data?.message || "").includes("uniq_vk_hash");

    if (!isAlreadyRegistered) {
      throw error;
    }

    // Another concurrent proof flow already registered this VK.
    // Wait briefly and fetch the active circuit row that should now include vk_hash.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await sleep(200 * (attempt + 1));
      const active = await safeTrack("fetch active circuit after vk conflict", async () =>
        trackingService.getActiveCircuit(circuit_name),
      );
      if (active?.vk_hash) {
        vkHash = active.vk_hash;
        break;
      }
    }
  }

  const setupRow = await safeTrack("upsert circuit setup", async () => {
    if (context.gameId) {
      await trackingService.ensureGameSession(context.gameId);
    }
    return trackingService.upsertCircuitSetup({
      kind: circuit_name,
      compiledCircuit: circuit,
      verificationKeyHex,
      vkHash: vkHash || "0x" + hashString(verificationKeyHex).slice(0, 64),
      artifactSha256,
      sessionUuid: context.gameId,
    });
  });

  return {
    circuitUuid: setupRow?.circuit_uuid ?? null,
    vkHash: vkHash || setupRow?.vk_hash || null,
    verificationKeyHex,
  };
}

async function ensureCircuitSetup(
  circuit_name: CircuitKind,
  context: TrackingContext,
): Promise<EnsureCircuitResult> {
  const cached = _circuitSetupCache.get(circuit_name);
  if (cached) {
    return cached;
  }

  const inFlight = _circuitSetupInFlight.get(circuit_name);
  if (inFlight) {
    return inFlight;
  }

  const setupPromise = (async () => {
    const activeCircuit = await safeTrack("fetch active circuit", async () =>
      trackingService.getActiveCircuit(circuit_name),
    );

    if (activeCircuit?.vk_hash) {
      if (context.gameId) {
        await safeTrack("link active circuit to session", async () =>
          trackingService.upsertCircuitSetup({
            kind: circuit_name,
            compiledCircuit: activeCircuit.compiled_circuit,
            verificationKeyHex: activeCircuit.vkey_hex,
            vkHash: activeCircuit.vk_hash,
            artifactSha256: activeCircuit.artifact_sha256,
            sessionUuid: context.gameId,
          }),
        );
      }
      return {
        circuitUuid: activeCircuit.circuit_uuid ?? null,
        vkHash: activeCircuit.vk_hash,
        verificationKeyHex: activeCircuit.vkey_hex,
      };
    }

    return registerVk(circuit_name, context);
  })();

  _circuitSetupInFlight.set(circuit_name, setupPromise);
  try {
    const result = await setupPromise;
    _circuitSetupCache.set(circuit_name, result);
    return result;
  } finally {
    _circuitSetupInFlight.delete(circuit_name);
  }
}

// generating circuit specific ultrahonk proof with the given inputs
export async function generateProof(
  circuit_name: CircuitKind,
  inputs: Record<string, any>,
  context: TrackingContext = {},
): Promise<{ proofHex: string; publicInputs: string[]; proofUuid: string | null }> {
  const { noir, backend } = setupProver(circuit_name);

  console.log(
    `## Extracting parameters and matching inputs for ${circuit_name}`,
  );
  const abi = loadCircuitAbi(circuit_name);
  validateAbiInput(inputs, abi);
  const params = extractAbiParameters(inputs, abi);
  console.log(`## Creating private witness for ${circuit_name}`);
  const { witness } = await noir.execute(params);

  console.log(`## Generating Proof for ${circuit_name}`);
  const proof_data = await backend.generateProof(witness, {
    keccak: true,
  });

  const proofHex = uint8ArrayToHex(proof_data.proof);
  const publicInputs = normalizePublicInputs(proof_data.publicInputs);

  console.log(`## Verifying Proof w/ BB.js for ${circuit_name}`);
  const isValid = await backend.verifyProof(proof_data, {
    keccak: true,
  });
  if (!isValid) {
    throw new Error("[ERR: Proof] Proof verification failed");
  }

  let proofUuid: string | null = null;
  if (context.gameId) {
    const circuitSetup = await ensureCircuitSetup(circuit_name, context);
    if (circuitSetup.circuitUuid) {
      const createdProofUuid = await safeTrack("create proof record", async () =>
        trackingService.createProofRecord({
          sessionUuid: context.gameId!,
          circuitUuid: circuitSetup.circuitUuid!,
          playerAddress: context.playerAddress?.toLowerCase() || null,
          proofHex,
          publicInputs,
          bbVerificationStatus: true,
        }),
      );
      proofUuid = createdProofUuid ?? null;
    }
  }

  return {
    proofHex,
    publicInputs,
    proofUuid,
  };
}

export async function verifyProof(
  circuit_name: CircuitKind,
  proofHex: string,
  formattedPublicInputs: string[],
  context: TrackingContext = {},
) {
  const { KURIER_URL, KURIER_API } = process.env;
  if (!KURIER_URL || !KURIER_API) {
    throw new Error("[ERR: Env] Missing environment variables");
  }

  const circuitSetup = await ensureCircuitSetup(circuit_name, context);
  const vkHash = circuitSetup.vkHash;
  if (vkHash) {
    console.log(`## vkHash found for ${circuit_name}: ${vkHash}`);
  } else {
    console.log(
      `[WARN: ZKV] vkHash unavailable for ${circuit_name}; submitting with full verification key`,
    );
  }

  const proofPayload = {
    proofType: "ultrahonk",
    vkRegistered: Boolean(vkHash),
    chainId: 84532,
    proofOptions: {
      variant: "Plain",
    },
    proofData: {
      proof: `${proofHex}`,
      publicSignals: normalizePublicInputs(formattedPublicInputs),
      vk: vkHash || circuitSetup.verificationKeyHex,
    },
    submissionMode: "attestation",
  };

  console.log("## Submitting Proof to Kurier");
  const submitResponse = await axios.post(
    `${KURIER_URL}/submit-proof/${KURIER_API}`,
    proofPayload,
  );

  console.log(
    `Proof response status code for ${circuit_name}:`,
    submitResponse.status,
  );
  if (submitResponse.data.optimisticVerify !== "success") {
    throw new Error("[ERR: Proof Verification] Optimistic verification failed");
  }

  const jobId = submitResponse.data.jobId;
  console.log(
    `## Proof submitted successfully for ${circuit_name}. Job ID: ${jobId}`,
  );

  const proofUuid = context.proofUuid ?? null;
  let submittedJobPersisted = false;
  try {
    await trackingService.upsertVerificationJob({
      jobId,
      status: "Submitted",
      aggregationResponse: submitResponse.data,
    });
    submittedJobPersisted = true;
  } catch (error: any) {
    console.error(
      "[TRACKING] upsert submitted job failed:",
      error?.message || error,
    );
  }

  if (proofUuid && context.gameId) {
    if (!submittedJobPersisted) {
      console.warn(
        `[TRACKING] skipping proof submission attach for ${proofUuid} because verification job ${jobId} was not persisted`,
      );
    } else {
      await safeTrack("persist proof submission", async () =>
        trackingService.attachProofSubmission(
          context.gameId!,
          proofUuid,
          jobId,
          proofPayload,
          submitResponse.data,
        ),
      );
    }
  }

  let transientPollFailures = 0;
  while (true) {
    let jobStatusResponse;
    try {
      jobStatusResponse = await axios.get(
        `${KURIER_URL}/job-status/${KURIER_API}/${jobId}`,
      );
      transientPollFailures = 0;
    } catch (error: any) {
      transientPollFailures += 1;
      const code = error?.code || "UNKNOWN";
      console.warn(
        `[WARN: ZKV] polling job-status failed for ${jobId} (${code}), attempt ${transientPollFailures}`,
      );
      if (transientPollFailures >= 10) {
        throw new Error(
          `[ERR: ZKV] job status polling failed repeatedly for ${jobId}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 10000));
      continue;
    }

    const jobStatus = jobStatusResponse.data?.status;
    const aggregationDetails = jobStatusResponse.data?.aggregationDetails || null;

    if (typeof jobStatus === "string") {
      await safeTrack("upsert job status", async () =>
        trackingService.upsertVerificationJob({
          jobId,
          status: jobStatus as any,
          aggregationId: toNumberOrNull(jobStatusResponse.data?.aggregationId),
          aggregationResponse: jobStatusResponse.data,
          leaf: aggregationDetails?.leaf ?? null,
          leafIndex: toNumberOrNull(aggregationDetails?.leafIndex),
          numberOfLeaves: toNumberOrNull(aggregationDetails?.numberOfLeaves),
          merkleProof: Array.isArray(aggregationDetails?.merkleProof)
            ? aggregationDetails.merkleProof
            : null,
          statement: jobStatusResponse.data?.statement ?? null,
          txHash: jobStatusResponse.data?.txHash ?? null,
        }),
      );
    }

    if (jobStatus === "Aggregated") {
      console.log("##Job aggregated successfully");
      const aggregationId = toNumberOrNull(jobStatusResponse.data?.aggregationId);
      const leaf = aggregationDetails?.leaf ?? null;
      const merkleProof = Array.isArray(aggregationDetails?.merkleProof)
        ? aggregationDetails.merkleProof
        : [];
      const leafCount = toNumberOrNull(aggregationDetails?.numberOfLeaves);
      const leafIndex = toNumberOrNull(aggregationDetails?.leafIndex);
      const domainIdFromEnv = toNumberOrNull(process.env.ZKVERIFY_DOMAIN_ID);

      let onchain = {
        attempted: false,
        verified: false,
        domainId: null as number | null,
        txHash: null as string | null,
        contractAddress: process.env.CARDWAR_REGISTRY_ADDRESS || null,
      };

      if (
        context.gameId &&
        aggregationId !== null &&
        leaf &&
        merkleProof.length > 0 &&
        leafCount !== null &&
        leafIndex !== null
      ) {
        onchain = await verifyAndRecordAggregationOnChain({
          gameId: context.gameId,
          aggregationId,
          leaf,
          merklePath: merkleProof,
          leafCount,
          leafIndex,
        });
      }
      const resolvedDomainId = onchain.domainId ?? domainIdFromEnv;

      if (proofUuid) {
        await safeTrack("update proof onchain status", async () =>
          trackingService.setProofOnchainVerificationStatus(
            proofUuid,
            onchain.attempted ? onchain.verified : null,
          ),
        );
      }

      if (
        proofUuid &&
        resolvedDomainId !== null &&
        aggregationId !== null &&
        leaf &&
        merkleProof.length > 0 &&
        leafCount !== null &&
        leafIndex !== null
      ) {
        await safeTrack("insert aggregation verification", async () =>
          trackingService.recordAggregationVerification({
            proofUuid,
            zkverifyContractAddress:
              onchain.contractAddress ||
              process.env.CARDWAR_REGISTRY_ADDRESS ||
              "unconfigured",
            domainId: resolvedDomainId,
            aggregationId,
            leaf,
            merklePath: merkleProof,
            leafCount,
            leafIndex,
            verified: onchain.verified,
            txHash: onchain.txHash,
          }),
        );
      }

      return {
        jobId,
        status: jobStatus,
        aggregationId,
        domainId: resolvedDomainId,
        onchain,
      };
    } else if (jobStatus === "Failed") {
      console.error("##Job failed:", jobStatusResponse.data);
      if (proofUuid) {
        await safeTrack("mark onchain verification failed", async () =>
          trackingService.setProofOnchainVerificationStatus(proofUuid, false),
        );
      }
      throw new Error("[ERR: ZKV] Proof aggregation failed");
    } else {
      console.log("##Job status: ", jobStatus);
      console.log(`==> Waiting for job to be aggregated...`);
      await new Promise((resolve) => setTimeout(resolve, 20000)); // Wait for 20 seconds before checking again
    }
  }
}

export async function verifySessionAggregationsOnChain(
  gameId: string,
): Promise<SessionOnChainVerificationSummary> {
  const rows =
    (await safeTrack("fetch session proof jobs", async () =>
      trackingService.getSessionProofJobs(gameId),
    )) ?? [];

  const summary: SessionOnChainVerificationSummary = {
    gameId,
    totalJobs: rows.length,
    verifiedCount: 0,
    failedCount: 0,
    skippedAlreadyVerified: 0,
    skippedNotAggregated: 0,
    skippedMissingData: 0,
  };

  if (rows.length === 0) {
    console.warn(`[ZK: SESSION] no tracked jobs found for game ${gameId}`);
    return summary;
  }

  const domainIdFromEnv = toNumberOrNull(process.env.ZKVERIFY_DOMAIN_ID);
  for (const row of rows) {
    const jobId = row.job_id;
    if (row.onchain_verification_status === true) {
      summary.skippedAlreadyVerified += 1;
      continue;
    }

    if (row.status !== "Aggregated") {
      summary.skippedNotAggregated += 1;
      console.log(
        `[ZK: SESSION] skipping job ${jobId} for game ${gameId}: status=${row.status || "unknown"}`,
      );
      continue;
    }

    const aggregationId = toNumberOrNull(row.aggregation_id);
    const leaf = row.leaf ?? null;
    const merklePath = Array.isArray(row.merkle_proof) ? row.merkle_proof : [];
    const leafCount = toNumberOrNull(row.number_of_leaves);
    const leafIndex = toNumberOrNull(row.leaf_index);
    const proofUuid = row.proof_uuid ?? null;

    if (
      aggregationId === null ||
      !leaf ||
      merklePath.length === 0 ||
      leafCount === null ||
      leafIndex === null
    ) {
      summary.skippedMissingData += 1;
      console.warn(
        `[ZK: SESSION] skipping job ${jobId} for game ${gameId}: missing aggregation details`,
      );
      continue;
    }

    const onchain = await verifyAndRecordAggregationOnChain({
      gameId,
      aggregationId,
      leaf,
      merklePath,
      leafCount,
      leafIndex,
    });

    const resolvedDomainId = onchain.domainId ?? domainIdFromEnv;
    if (proofUuid) {
      await safeTrack("update proof onchain status (session)", async () =>
        trackingService.setProofOnchainVerificationStatus(
          proofUuid,
          onchain.attempted ? onchain.verified : null,
        ),
      );

      if (resolvedDomainId !== null) {
        await safeTrack("insert aggregation verification (session)", async () =>
          trackingService.recordAggregationVerification({
            proofUuid,
            zkverifyContractAddress:
              onchain.contractAddress ||
              process.env.CARDWAR_REGISTRY_ADDRESS ||
              "unconfigured",
            domainId: resolvedDomainId,
            aggregationId,
            leaf,
            merklePath,
            leafCount,
            leafIndex,
            verified: onchain.verified,
            txHash: onchain.txHash,
          }),
        );
      }
    } else {
      console.warn(
        `[ZK: SESSION] missing proof_uuid for game ${gameId}, job ${jobId}; on-chain result not persisted to proofs`,
      );
    }

    if (onchain.verified) {
      summary.verifiedCount += 1;
    } else {
      summary.failedCount += 1;
    }
  }

  console.log(
    `[ZK: SESSION] game ${gameId} on-chain verification summary`,
    summary,
  );
  return summary;
}
