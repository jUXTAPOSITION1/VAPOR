import { isAddressEqual, getAddress } from "viem";
import type { PaymentRequirements, RiskAssessment } from "../../types/x402.js";
import { config } from "../../config/index.js";
import { logger } from "../../utils/logger.js";

export interface PolicyDecision {
  allowed: boolean;
  reason?: string;
}

/**
 * Per-payee overrides, carried in `paymentRequirements.extra` (the x402 spec
 * reserves this field for exactly this kind of scheme/facilitator-specific
 * data). Every field is optional; anything omitted falls back to VAPOR's
 * configured defaults so a payee that never opts in still gets sane
 * protection rather than none.
 */
interface PolicyExtra {
  maxRiskScore?: number;
  maxAmountUsd?: number;
  minAmountUsd?: number;
  denyList?: string[];
}

function parseExtra(extra: Record<string, unknown> | undefined): PolicyExtra {
  if (!extra || typeof extra !== "object") return {};
  const policy = extra["policy"];
  if (!policy || typeof policy !== "object") return {};
  return policy as PolicyExtra;
}

/**
 * VAPOR's configurable risk policy — evaluated only after signature,
 * replay, and balance checks already passed (see verification.service.ts).
 * A denial here means "this payment is cryptographically and financially
 * valid, but the payee's own rules say don't take it" — a distinct outcome
 * from an invalid payment, which is why it's surfaced as its own reason.
 */
export function evaluatePolicy(
  paymentRequirements: PaymentRequirements,
  riskAssessment: RiskAssessment,
  value: bigint,
  decimals: number,
  payer: `0x${string}`
): PolicyDecision {
  const extra = parseExtra(paymentRequirements.extra);

  const denyList = extra.denyList ?? [];
  for (const denied of denyList) {
    try {
      if (isAddressEqual(getAddress(denied), payer)) {
        return { allowed: false, reason: "payer is on this payee's deny list" };
      }
    } catch (err) {
      logger.warn({ err, denied }, "malformed address in policy deny list, skipping entry");
    }
  }

  const maxRiskScore = extra.maxRiskScore ?? config.policyDefaults.maxRiskScore;
  if (riskAssessment.score > maxRiskScore) {
    return {
      allowed: false,
      reason: `risk score ${riskAssessment.score} exceeds policy maximum of ${maxRiskScore}`,
    };
  }

  // USDC is a 1:1 USD-pegged stablecoin, so its raw token amount is used
  // directly as a USD figure — no price oracle needed for this asset.
  const amountUsd = Number(value) / 10 ** decimals;

  const maxAmountUsd = extra.maxAmountUsd ?? config.policyDefaults.maxAmountUsd;
  if (amountUsd > maxAmountUsd) {
    return {
      allowed: false,
      reason: `amount $${amountUsd} exceeds policy maximum of $${maxAmountUsd}`,
    };
  }

  if (extra.minAmountUsd !== undefined && amountUsd < extra.minAmountUsd) {
    return {
      allowed: false,
      reason: `amount $${amountUsd} is below policy minimum of $${extra.minAmountUsd}`,
    };
  }

  return { allowed: true };
}
