import { Router } from "express";
import { registry } from "../../core/metrics/metrics.service.js";
import { requireApiKey, isUnscopedKey } from "../middleware/auth.middleware.js";

export const metricsRouter = Router();

/**
 * Prometheus scrape target. Gated behind the same API key as /analytics —
 * it's operational detail for VAPOR's own operator, unlike /stats which is
 * deliberately public for the dashboard. Requires an unscoped key
 * specifically: a key scoped to one payTo (see config/api-keys.ts) is meant
 * for that payee's own data, not facility-wide metrics covering every
 * payee this facilitator serves.
 */
metricsRouter.get("/metrics", requireApiKey, async (_req, res) => {
  if (!isUnscopedKey(res)) {
    res.status(403).json({ error: "a payTo-scoped API key cannot access facility-wide metrics" });
    return;
  }
  res.setHeader("content-type", registry.contentType);
  res.status(200).send(await registry.metrics());
});
