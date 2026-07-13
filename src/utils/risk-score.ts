import type { OnChainSignal } from "../core/risk/providers/onchain-heuristics.provider.js";
import type { ReputationSignal } from "../core/risk/providers/reputation-intel.provider.js";
import type { RiskAssessment } from "../types/x402.js";

/**
 * Pure, deterministic scoring — no I/O, fully unit-testable. Every weight
 * below is a documented, defensible heuristic, not a black box:
 *
 * - A reputation-provider flag is the strongest signal available and
 *   dominates the score, but is still just ADDED to (not the sole
 *   determinant of) the final score — an unflagged-but-brand-new wallet
 *   still registers as elevated risk.
 * - Zero prior transactions is the single strongest on-chain-only signal:
 *   a wallet funded once and used once for exactly one payment is the
 *   dominant shape of a disposable/scam wallet, and is also trivially true
 *   of any brand-new legitimate wallet — this is a real, INHERENT
 *   limitation of on-chain-only scoring, not something more heuristics
 *   erase. It's exactly why this stays a score for the payee's policy to
 *   threshold against, never an automatic block VAPOR decides on its own.
 * - Being a contract (vs. an EOA) is informational, not penalized on its
 *   own — smart-contract wallets are an increasingly normal way to pay,
 *   not inherently suspicious.
 */
export function computeRiskScore(
  onChain: OnChainSignal,
  reputation: ReputationSignal | null
): RiskAssessment {
  let score = 0;
  const reasons: string[] = [];

  if (reputation?.flagged) {
    score += 60;
    if (reputation.categories.length > 0) {
      reasons.push(`flagged by reputation provider: ${reputation.categories.join(", ")}`);
    } else {
      reasons.push("flagged by reputation provider");
    }
  }

  if (onChain.transactionCount === 0) {
    score += 25;
    reasons.push("address has zero prior transactions");
  } else if (onChain.transactionCount < 3) {
    score += 10;
    reasons.push(`address has very few prior transactions (${onChain.transactionCount})`);
  }

  if (onChain.isContract) {
    reasons.push("payer address is a contract, not an externally-owned account");
  }

  score = Math.min(100, score);

  const band: RiskAssessment["band"] = score >= 75 ? "severe" : score >= 50 ? "high" : score >= 25 ? "medium" : "low";

  return {
    score,
    band,
    reasons,
    checkedAt: new Date().toISOString(),
  };
}
