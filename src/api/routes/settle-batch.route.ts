import { Router } from "express";
import type { BatchSettleRequest } from "../../types/x402.js";
import { settlePayment } from "../../core/settlement/settlement.service.js";
import { validateBody } from "../middleware/validate.middleware.js";
import { batchRequestSchema } from "../schemas/x402.schemas.js";
import { recordSettlement } from "../../storage/repositories/payment-record.repository.js";
import { dispatchWebhook, webhookUrlFromExtra } from "../../core/webhooks/webhook.service.js";
import { logger } from "../../utils/logger.js";
import { settleOutcomesTotal } from "../../core/metrics/metrics.service.js";

export const settleBatchRouter = Router();

/**
 * Settles several independent "exact"-scheme payments in one call.
 *
 * Processed SEQUENTIALLY, not in parallel — every settlement broadcasts
 * from VAPOR's one settlement-signer wallet, and viem's wallet client
 * assigns each transaction's nonce by reading the account's current
 * transaction count at send time. Firing several settlePayment() calls
 * concurrently would race on that read, risking two transactions claiming
 * the same nonce (one gets dropped/replaced) instead of the N independent
 * on-chain transactions a batch caller expects. Verification (verify-batch)
 * has no such constraint since it never broadcasts anything.
 *
 * One item failing (invalid signature, insufficient balance, reverted tx)
 * never stops the batch — each entry gets its own success/failure result,
 * exactly like calling /settle N times.
 */
settleBatchRouter.post("/settle-batch", validateBody(batchRequestSchema), async (req, res) => {
  const { payments } = req.body as unknown as BatchSettleRequest;

  const results = [];
  for (const { paymentPayload, paymentRequirements } of payments) {
    const result = await settlePayment(paymentPayload, paymentRequirements);
    settleOutcomesTotal.inc({ success: String(result.success) });

    recordSettlement(paymentRequirements, result).catch((err) => {
      logger.warn({ err }, "failed to record settlement audit entry");
    });

    dispatchWebhook(
      webhookUrlFromExtra(paymentRequirements.extra),
      result.success ? "payment.settled" : "payment.settlement_failed",
      { paymentRequirements, result }
    );

    results.push(result);
  }

  res.status(200).json({ results });
});
