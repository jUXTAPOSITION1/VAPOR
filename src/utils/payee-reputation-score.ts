import type { OnChainSignal } from "../core/risk/providers/onchain-heuristics.provider.js";
import type { ReputationSignal } from "../core/risk/providers/reputation-intel.provider.js";
import type { PayeeReputation } from "../types/x402.js";

export interface PayeeHistory {
  totalVerifyRequests: number;
  totalSettlements: number;
  settlementSuccessRate: number | null;
  totalSettledVolumeUsd: number;
  firstSeenAt: string | null;
}

/** Result of an opt-in ERC-8004 lookup — see erc8004.client.ts. `verified`
 * is false when the caller-supplied agentId's on-chain wallet doesn't
 * actually match payTo, in which case it contributes no score bonus. */
export interface Erc8004Check {
  agentId: string;
  verified: boolean;
  feedbackCount: number;
  averageScore: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Pure, deterministic scoring for the payee/service side — the mirror of
 * risk-score.ts, but positively framed: a payer wants to know "is this
 * service established and clean," not "how risky is it," because a
 * brand-new legitimate service and a scam both start at zero history.
 * Tenure/volume/success-rate build trust; a reputation-provider flag
 * overrides all of it, since fabricated self-settlement volume is exactly
 * the kind of thing a scam operator could otherwise game this score with.
 */
export function computePayeeReputation(
  payTo: `0x${string}`,
  onChain: OnChainSignal,
  reputation: ReputationSignal | null,
  history: PayeeHistory,
  erc8004?: Erc8004Check
): PayeeReputation {
  let score = 0;
  const reasons: string[] = [];

  if (history.totalSettlements > 0) {
    score += 25;
    reasons.push(`has ${history.totalSettlements} completed settlement(s)`);
  }
  if (history.totalSettlements >= 10) score += 20;
  if (history.totalSettlements >= 100) score += 20;

  if (history.firstSeenAt) {
    const ageMs = Date.now() - new Date(history.firstSeenAt).getTime();
    if (ageMs >= 30 * DAY_MS) {
      score += 15;
      reasons.push("active for 30+ days");
    }
    if (ageMs >= 180 * DAY_MS) {
      score += 10;
      reasons.push("active for 180+ days");
    }
  }

  if (
    history.settlementSuccessRate !== null &&
    history.totalVerifyRequests >= 5 &&
    history.settlementSuccessRate >= 0.9
  ) {
    score += 10;
    reasons.push(`${Math.round(history.settlementSuccessRate * 100)}% settlement success rate`);
  }

  if (erc8004?.verified && erc8004.feedbackCount > 0 && erc8004.averageScore !== null && erc8004.averageScore > 0) {
    score += 15;
    reasons.push(
      `verified ERC-8004 agent with ${erc8004.feedbackCount} feedback record(s), avg score ${erc8004.averageScore.toFixed(2)}`
    );
  }

  score = Math.min(100, score);

  const flaggedByReputationProvider = reputation?.flagged ?? false;
  if (flaggedByReputationProvider) {
    // A flag overrides accumulated history — the whole point of an
    // external signal is to catch cases where on-VAPOR history alone
    // (which a scam operator fully controls, including self-settlement)
    // would otherwise look clean.
    score = Math.min(score, 10);
    reasons.unshift(
      reputation && reputation.categories.length > 0
        ? `flagged by reputation provider: ${reputation.categories.join(", ")}`
        : "flagged by reputation provider"
    );
  }

  if (onChain.isContract) {
    reasons.push("payee address is a contract, not an externally-owned account");
  }

  const band: PayeeReputation["band"] = flaggedByReputationProvider
    ? "new"
    : score >= 80
      ? "veteran"
      : score >= 50
        ? "established"
        : score >= 20
          ? "emerging"
          : "new";

  return {
    payTo,
    score,
    band,
    history,
    flaggedByReputationProvider,
    reasons,
    checkedAt: new Date().toISOString(),
    ...(erc8004 ? { erc8004 } : {}),
  };
}
