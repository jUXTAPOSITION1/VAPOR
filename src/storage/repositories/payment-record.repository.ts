import { appendChainedRecord } from "../../core/audit/audit-chain.service.js";
import type { PaymentRequirements, VerifyResponse, SettleResponse } from "../../types/x402.js";

/**
 * Persists one audit row per /verify or /settle call. Best-effort: a
 * logging failure must never block or fail the payment decision itself,
 * so callers fire-and-forget this and only log on error.
 *
 * Goes through appendChainedRecord (not a raw prisma.paymentRecord.create)
 * so every row is linked into the tamper-evident hash chain — see
 * src/core/audit/audit-chain.service.ts.
 */
export async function recordVerification(
  paymentRequirements: PaymentRequirements,
  result: VerifyResponse
): Promise<void> {
  await appendChainedRecord({
    stage: "verify",
    network: paymentRequirements.network,
    resource: paymentRequirements.resource,
    payTo: paymentRequirements.payTo,
    asset: paymentRequirements.asset,
    amount: paymentRequirements.maxAmountRequired,
    payer: result.payer,
    isValid: result.isValid,
    invalidReason: result.invalidReason,
    riskScore: result.riskAssessment?.score,
    riskBand: result.riskAssessment?.band,
    riskReasons: result.riskAssessment ? JSON.stringify(result.riskAssessment.reasons) : undefined,
    settled: undefined,
    transactionHash: undefined,
    errorReason: undefined,
  });
}

export async function recordSettlement(
  paymentRequirements: PaymentRequirements,
  result: SettleResponse
): Promise<void> {
  await appendChainedRecord({
    stage: "settle",
    network: paymentRequirements.network,
    resource: paymentRequirements.resource,
    payTo: paymentRequirements.payTo,
    asset: paymentRequirements.asset,
    amount: paymentRequirements.maxAmountRequired,
    payer: result.payer,
    isValid: result.success,
    invalidReason: result.errorReason,
    riskScore: undefined,
    riskBand: undefined,
    riskReasons: undefined,
    settled: result.success,
    transactionHash: result.transaction || undefined,
    errorReason: result.errorReason,
  });
}
