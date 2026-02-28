import axios from "axios";
import { trackingService } from "../tracking/service";
import { verifySessionAggregationsOnChain } from "./prove";

let reconcileTimer: NodeJS.Timeout | null = null;
let running = false;

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

async function reconcileOnce() {
  if (running) return;
  running = true;
  try {
    const { KURIER_URL, KURIER_API } = process.env;
    if (!KURIER_URL || !KURIER_API) return;

    const batchSize = Number(process.env.ZK_RECONCILE_BATCH_SIZE || 25);
    const staleSeconds = Number(process.env.ZK_RECONCILE_STALE_SECONDS || 60);
    const jobs = await trackingService.getStaleJobsForReconciliation(
      Number.isFinite(batchSize) ? batchSize : 25,
      Number.isFinite(staleSeconds) ? staleSeconds : 60,
    );
    if (!jobs.length) return;

    const affectedSessions = new Set<string>();
    for (const job of jobs) {
      try {
        const statusResponse = await axios.get(
          `${KURIER_URL}/job-status/${KURIER_API}/${job.job_id}`,
        );
        const data = statusResponse.data || {};
        const aggregationDetails = data?.aggregationDetails || null;
        const status = data?.status;
        if (typeof status !== "string") continue;

        await trackingService.upsertVerificationJob({
          jobId: job.job_id,
          status: status as any,
          aggregationId: toNumberOrNull(data?.aggregationId),
          aggregationResponse: data,
          leaf: aggregationDetails?.leaf ?? null,
          leafIndex: toNumberOrNull(aggregationDetails?.leafIndex),
          numberOfLeaves: toNumberOrNull(aggregationDetails?.numberOfLeaves),
          merkleProof: Array.isArray(aggregationDetails?.merkleProof)
            ? aggregationDetails.merkleProof
            : null,
          statement: data?.statement ?? null,
          txHash: data?.txHash ?? null,
        });

        if (job.session_uuid) {
          affectedSessions.add(job.session_uuid);
        }
      } catch (error: any) {
        console.warn(
          `[ZK: RECONCILE] failed for job ${job.job_id}:`,
          error?.message || error,
        );
      }
    }

    for (const sessionId of affectedSessions) {
      try {
        await verifySessionAggregationsOnChain(sessionId);
      } catch (error: any) {
        console.warn(
          `[ZK: RECONCILE] session on-chain reconcile failed for ${sessionId}:`,
          error?.message || error,
        );
      }
    }
  } finally {
    running = false;
  }
}

export function startJobReconcileWorker() {
  const enabled = process.env.ZK_RECONCILE_ENABLED !== "false";
  if (!enabled || reconcileTimer) return;

  const intervalMs = Number(process.env.ZK_RECONCILE_INTERVAL_MS || 30000);
  const resolvedInterval = Number.isFinite(intervalMs) ? intervalMs : 30000;

  reconcileOnce().catch((error) => {
    console.error(
      "[ZK: RECONCILE] initial reconcile run failed:",
      error?.message || error,
    );
  });

  reconcileTimer = setInterval(() => {
    reconcileOnce().catch((error) => {
      console.error(
        "[ZK: RECONCILE] periodic reconcile run failed:",
        error?.message || error,
      );
    });
  }, resolvedInterval);

  console.log(
    `[ZK: RECONCILE] worker started (interval=${resolvedInterval}ms)`,
  );
}

export function stopJobReconcileWorker() {
  if (!reconcileTimer) return;
  clearInterval(reconcileTimer);
  reconcileTimer = null;
}
