import { Router } from "express";
import type { VerifyRequest } from "../../types/x402.js";
import { verifyPayment } from "../../core/verification/verification.service.js";
import { validateBody } from "../middleware/validate.middleware.js";
import { verifyRequestSchema } from "../schemas/x402.schemas.js";
import { recordVerification } from "../../storage/repositories/payment-record.repository.js";
import { dispatchWebhook, webhookUrlFromExtra } from "../../core/webhooks/webhook.service.js";
import { logger } from "../../utils/logger.js";

export const verifyRouter = Router();

verifyRouter.post("/verify", validateBody(verifyRequestSchema), async (req, res) => {
  const { paymentPayload, paymentRequirements } = req.body as unknown as VerifyRequest;

  const result = await verifyPayment(paymentPayload, paymentRequirements);

  recordVerification(paymentRequirements, result).catch((err) => {
    logger.warn({ err }, "failed to record verification audit entry");
  });

  dispatchWebhook(
    webhookUrlFromExtra(paymentRequirements.extra),
    result.isValid ? "payment.verified" : "payment.denied",
    { paymentRequirements, result }
  );

  res.status(200).json(result);
});
