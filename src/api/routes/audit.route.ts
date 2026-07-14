import { Router } from "express";
import { verifyAuditChain } from "../../core/audit/audit-chain.service.js";
import { requireApiKey, isUnscopedKey } from "../middleware/auth.middleware.js";

export const auditRouter = Router();

/**
 * Recomputes and checks the PaymentRecord hash chain end-to-end (see
 * core/audit/audit-chain.service.ts) — the operator's way to actually ask
 * "has the audit log been tampered with" without a DB console. Gated like
 * /metrics: facility-wide operator detail, so a payTo-scoped key is
 * rejected even though it's otherwise a valid key.
 */
auditRouter.get("/audit/verify-chain", requireApiKey, async (_req, res) => {
  if (!isUnscopedKey(res)) {
    res.status(403).json({ error: "a payTo-scoped API key cannot access facility-wide audit verification" });
    return;
  }
  const result = await verifyAuditChain();
  res.status(200).json(result);
});
