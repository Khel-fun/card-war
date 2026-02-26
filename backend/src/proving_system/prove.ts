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
  domainId?: number;
};

type EnsureCircuitResult = {
  circuitUuid: string | null;
  vkHash: string;
  verificationKeyHex: string;
};

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
  const reg_vk_response = await axios.post(
    `${KURIER_URL}/register-vk/${KURIER_API}`,
    vk_payload,
  );

  const vkHash = reg_vk_response.data?.vkHash || reg_vk_response.data?.meta?.vkHash;
  if (!vkHash) {
    throw new Error("[ERR: ZKV] Verification key hash missing from Kurier response");
  }

  const setupRow = await safeTrack("upsert circuit setup", async () => {
    if (context.gameId) {
      await trackingService.ensureGameSession(context.gameId);
    }
    return trackingService.upsertCircuitSetup({
      kind: circuit_name,
      compiledCircuit: circuit,
      verificationKeyHex,
      vkHash,
      artifactSha256,
      sessionUuid: context.gameId,
    });
  });

  return {
    circuitUuid: setupRow?.circuit_uuid ?? null,
    vkHash,
    verificationKeyHex,
  };
}

async function ensureCircuitSetup(
  circuit_name: CircuitKind,
  context: TrackingContext,
): Promise<EnsureCircuitResult> {
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
  if (!vkHash) {
    throw new Error("[ERR: ZKV] Verification key hash not found");
  }
  console.log(`## vkHash found for ${circuit_name}: ${vkHash}`);

  const proofPayload = {
    proofType: "ultrahonk",
    vkRegistered: true,
    chainId: 84532,
    proofOptions: {
      variant: "Plain",
    },
    proofData: {
      proof: `${proofHex}`,
      publicSignals: normalizePublicInputs(formattedPublicInputs),
      vk: vkHash as string,
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
  if (proofUuid && context.gameId) {
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

  await safeTrack("upsert submitted job", async () =>
    trackingService.upsertVerificationJob({
      jobId,
      status: "Submitted",
      aggregationResponse: submitResponse.data,
    }),
  );

  while (true) {
    const jobStatusResponse = await axios.get(
      `${KURIER_URL}/job-status/${KURIER_API}/${jobId}`,
    );
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
      const domainId = context.domainId ?? domainIdFromEnv;

      let onchain = {
        attempted: false,
        verified: false,
        txHash: null as string | null,
        contractAddress: process.env.CARDWAR_REGISTRY_ADDRESS || null,
      };

      if (
        context.gameId &&
        domainId !== null &&
        aggregationId !== null &&
        leaf &&
        merkleProof.length > 0 &&
        leafCount !== null &&
        leafIndex !== null
      ) {
        onchain = await verifyAndRecordAggregationOnChain({
          gameId: context.gameId,
          domainId,
          aggregationId,
          leaf,
          merklePath: merkleProof,
          leafCount,
          leafIndex,
        });
      }

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
        domainId !== null &&
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
            domainId,
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
        domainId,
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
