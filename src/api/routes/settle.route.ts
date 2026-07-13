import { Router } from "express";
import type { SettleRequest } from "../../types/x402.js";
import { settlePayment } from "../../core/settlement/settlement.service.js";
import { validateBody } from "../middleware/validate.middleware.js";
import { settleRequestSchema } from "../schemas/x402.schemas.js";
import { recordSettlement } from "../../storage/repositories/payment-record.repository.js";
import { dispatchWebhook, webhookUrlFromExtra } from "../../core/webhooks/webhook.service.js";
import { logger } from "../../utils/logger.js";

export const settleRouter = Router();

settleRouter.post("/settle", validateBody(settleRequestSchema), async (req, res) => {
  const { paymentPayload, paymentRequirements } = req.body as unknown as SettleRequest;

  const result = await settlePayment(paymentPayload, paymentRequirements);

  recordSettlement(paymentRequirements, result).catch((err) => {
    logger.warn({ err }, "failed to record settlement audit entry");
  });

  dispatchWebhook(
    webhookUrlFromExtra(paymentRequirements.extra),
    result.success ? "payment.settled" : "payment.settlement_failed",
    { paymentRequirements, result }
  );

  res.status(200).json(result);
});
