import { Router } from "express";
import { registry } from "../../core/metrics/metrics.service.js";
import { requireApiKey } from "../middleware/auth.middleware.js";

export const metricsRouter = Router();

metricsRouter.use(requireApiKey);

/**
 * Prometheus scrape target. Gated behind the same API key as /analytics —
 * it's operational detail for VAPOR's own operator, unlike /stats which is
 * deliberately public for the dashboard.
 */
metricsRouter.get("/metrics", async (_req, res) => {
  res.setHeader("content-type", registry.contentType);
  res.status(200).send(await registry.metrics());
});
