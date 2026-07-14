import type { NetworkConfig } from "../../config/networks.js";
import { getPublicClient } from "../../blockchain/clients/chain.client.js";
import { fetchOnChainSignal } from "./providers/onchain-heuristics.provider.js";
import { checkReputation } from "./providers/reputation-intel.provider.js";
import { computeRiskScore } from "../../utils/risk-score.js";
import type { RiskAssessment } from "../../types/x402.js";
import { logger } from "../../utils/logger.js";
import { riskScoreDistribution } from "../metrics/metrics.service.js";

/**
 * A short-TTL cache keyed by (network, address), storing the in-flight
 * Promise rather than only the resolved value — this collapses not just
 * sequential re-scans within the window but genuinely concurrent ones too
 * (e.g. a payer calling /verify then /settle back-to-back, or several
 * /verify-batch entries for the same payer address). 3s is long enough to
 * dedupe that extremely common pattern (each scan costs a reputation-
 * provider round trip plus up to ~6 wallet-age RPC calls) while staying far
 * shorter than anything that would make the risk signal meaningfully stale.
 */
const CACHE_TTL_MS = 3_000;
const scanCache = new Map<string, { at: number; promise: Promise<RiskAssessment> }>();

function cacheKey(network: NetworkConfig, address: `0x${string}`): string {
  return `${network.caip2}:${address.toLowerCase()}`;
}

/**
 * VAPOR's core differentiator: scan a payer address BEFORE settlement
 * decisions are made, combining a real-time on-chain read (always
 * available) with an optional external reputation signal (additive,
 * degrades gracefully when unconfigured — see reputation-intel.provider.ts).
 */
export async function scanAddress(network: NetworkConfig, address: `0x${string}`): Promise<RiskAssessment> {
  const key = cacheKey(network, address);
  const cached = scanCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.promise;
  }

  const promise = performScan(network, address);
  scanCache.set(key, { at: Date.now(), promise });
  // A failed scan must never poison the cache for the rest of the TTL
  // window — clear it immediately so the next caller retries fresh instead
  // of getting the same rejection for up to CACHE_TTL_MS.
  promise.catch(() => scanCache.delete(key));
  return promise;
}

async function performScan(network: NetworkConfig, address: `0x${string}`): Promise<RiskAssessment> {
  const client = getPublicClient(network);

  const [onChain, reputation] = await Promise.all([
    fetchOnChainSignal(client, address),
    checkReputation(address, network.chain.id).catch((err) => {
      logger.warn({ err, address }, "reputation check threw unexpectedly, continuing without it");
      return null;
    }),
  ]);

  const assessment = computeRiskScore(onChain, reputation);
  riskScoreDistribution.observe(assessment.score);
  return assessment;
}

/** Purges expired entries so the cache's memory footprint stays bounded
 * over a long-running process's lifetime — without this, an address that's
 * scanned once and never again would sit in the map forever (it's only
 * ever removed on a subsequent lookup finding it stale, and one-off
 * addresses never get a subsequent lookup). Meant to be called on an
 * interval from the server bootstrap (see server.ts), same pattern as
 * webhook.service.ts's retryDueWebhooks. */
export function sweepExpiredScanCacheEntries(): void {
  const now = Date.now();
  for (const [key, entry] of scanCache) {
    if (now - entry.at >= CACHE_TTL_MS) scanCache.delete(key);
  }
}
