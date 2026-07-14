import { Router } from "express";
import type { SettleRequest, SettleResponse } from "../../types/x402.js";
import { settlePayment, settlePaymentAsync, isAsyncSettlementRequested } from "../../core/settlement/settlement.service.js";
import { validateBody } from "../middleware/validate.middleware.js";
import { settleRequestSchema } from "../schemas/x402.schemas.js";
import { recordSettlement } from "../../storage/repositories/payment-record.repository.js";
import { dispatchWebhook, webhookUrlFromExtra } from "../../core/webhooks/webhook.service.js";
import { logger } from "../../utils/logger.js";
import { settleOutcomesTotal } from "../../core/metrics/metrics.service.js";
import { paymentRateLimit } from "../middleware/rate-limit.middleware.js";

export const settleRouter = Router();

function finalizeAndReport(paymentRequirements: SettleRequest["paymentRequirements"], result: SettleResponse): void {
  settleOutcomesTotal.inc({ success: String(result.success) });

  recordSettlement(paymentRequirements, result).catch((err) => {
    logger.warn({ err }, "failed to record settlement audit entry");
  });

  dispatchWebhook(
    webhookUrlFromExtra(paymentRequirements.extra),
    result.success ? "payment.settled" : "payment.settlement_failed",
    { paymentRequirements, result }
  );
}

settleRouter.post("/settle", paymentRateLimit, validateBody(settleRequestSchema), async (req, res) => {
  const { paymentPayload, paymentRequirements } = req.body as unknown as SettleRequest;

  if (isAsyncSettlementRequested(paymentRequirements.extra)) {
    // The immediate `pending` response is NOT itself recorded/reported —
    // it isn't a real outcome yet. Only the eventual resolved result
    // (confirmed or failed) is, via this same finalizeAndReport, exactly
    // once, whenever the background confirmation lands.
    const result = await settlePaymentAsync(paymentPayload, paymentRequirements, (resolved) => {
      finalizeAndReport(paymentRequirements, resolved);
    });
    if (!result.pending) {
      // Broadcast never happened (invalid payment, no signer, malformed
      // signature) — this IS a final outcome, report it now like the sync
      // path does, since there's no background resolution coming.
      finalizeAndReport(paymentRequirements, result);
    }
    res.status(200).json(result);
    return;
  }

  const result = await settlePayment(paymentPayload, paymentRequirements);
  finalizeAndReport(paymentRequirements, result);
  res.status(200).json(result);
});
