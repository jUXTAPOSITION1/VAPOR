import { Router } from "express";
import type { BatchVerifyRequest } from "../../types/x402.js";
import { verifyPayment } from "../../core/verification/verification.service.js";
import { validateBody } from "../middleware/validate.middleware.js";
import { batchRequestSchema } from "../schemas/x402.schemas.js";
import { recordVerification } from "../../storage/repositories/payment-record.repository.js";
import { dispatchWebhook, webhookUrlFromExtra } from "../../core/webhooks/webhook.service.js";
import { logger } from "../../utils/logger.js";

export const verifyBatchRouter = Router();

/**
 * Verifies several independent "exact"-scheme payments in one call. Runs in
 * parallel — verification is read-only (signature/time-window/balance
 * checks), so there's no shared mutable state between entries the way
 * settlement has (see settle-batch.route.ts).
 */
verifyBatchRouter.post("/verify-batch", validateBody(batchRequestSchema), async (req, res) => {
  const { payments } = req.body as unknown as BatchVerifyRequest;

  const results = await Promise.all(
    payments.map(async ({ paymentPayload, paymentRequirements }) => {
      const result = await verifyPayment(paymentPayload, paymentRequirements);

      recordVerification(paymentRequirements, result).catch((err) => {
        logger.warn({ err }, "failed to record verification audit entry");
      });

      dispatchWebhook(
        webhookUrlFromExtra(paymentRequirements.extra),
        result.isValid ? "payment.verified" : "payment.denied",
        { paymentRequirements, result }
      );

      return result;
    })
  );

  res.status(200).json({ results });
});
