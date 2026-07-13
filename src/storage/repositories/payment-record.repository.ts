import { prisma } from "../prisma.client.js";
import type { PaymentRequirements, VerifyResponse, SettleResponse } from "../../types/x402.js";

/**
 * Persists one audit row per /verify or /settle call. Best-effort: a
 * logging failure must never block or fail the payment decision itself,
 * so callers fire-and-forget this and only log on error.
 */
export async function recordVerification(
  paymentRequirements: PaymentRequirements,
  result: VerifyResponse
): Promise<void> {
  await prisma.paymentRecord.create({
    data: {
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
    },
  });
}

export async function recordSettlement(
  paymentRequirements: PaymentRequirements,
  result: SettleResponse
): Promise<void> {
  await prisma.paymentRecord.create({
    data: {
      stage: "settle",
      network: paymentRequirements.network,
      resource: paymentRequirements.resource,
      payTo: paymentRequirements.payTo,
      asset: paymentRequirements.asset,
      amount: paymentRequirements.maxAmountRequired,
      payer: result.payer,
      isValid: result.success,
      invalidReason: result.errorReason,
      settled: result.success,
      transactionHash: result.transaction || undefined,
      errorReason: result.errorReason,
    },
  });
}
