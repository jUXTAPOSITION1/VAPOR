import { config } from "../../../config/index.js";
import { logger } from "../../../utils/logger.js";

export interface ReputationSignal {
  flagged: boolean;
  categories: string[];
}

/**
 * VAPOR defines its own small, stable contract for external reputation
 * intelligence rather than hardcoding one vendor's response schema:
 *
 *   GET {REPUTATION_PROVIDER_BASE_URL}/{address}?chain_id={chainId}
 *   -> { "flagged": boolean, "categories": string[] }
 *
 * This means VAPOR is never coupled to a specific threat-intel vendor —
 * an operator points REPUTATION_PROVIDER_BASE_URL at any service (a
 * managed one, an in-house one, or a thin adapter translating a vendor's
 * real response into this shape) and the risk scanner picks it up with no
 * code changes. Unset entirely, it's simply skipped: the on-chain
 * heuristics provider is the signal VAPOR always has, this is additive.
 *
 * Fails closed on the network/parse level (returns null, never throws
 * into the caller, never invents a signal) — a provider outage degrades
 * VAPOR's risk assessment to "on-chain heuristics only," it never produces
 * a false "clean" or false "flagged" result by guessing.
 */
export async function checkReputation(
  address: `0x${string}`,
  chainId: number
): Promise<ReputationSignal | null> {
  if (!config.reputationProvider.baseUrl) return null;

  const url = `${config.reputationProvider.baseUrl.replace(/\/$/, "")}/${address}?chain_id=${chainId}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: config.reputationProvider.apiKey
        ? { Authorization: `Bearer ${config.reputationProvider.apiKey}` }
        : undefined,
    });
    if (!res.ok) {
      logger.warn({ status: res.status, address }, "reputation provider returned non-OK status");
      return null;
    }
    const body = (await res.json()) as Partial<ReputationSignal>;
    if (typeof body.flagged !== "boolean") {
      logger.warn({ address }, "reputation provider response missing required 'flagged' field");
      return null;
    }
    return {
      flagged: body.flagged,
      categories: Array.isArray(body.categories) ? body.categories.filter((c) => typeof c === "string") : [],
    };
  } catch (err) {
    logger.warn({ err, address }, "reputation provider lookup failed");
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
