import express from "express";
import { pinoHttp } from "pino-http";
import { logger } from "../utils/logger.js";
import { verifyRouter } from "./routes/verify.route.js";
import { settleRouter } from "./routes/settle.route.js";
import { verifyBatchRouter } from "./routes/verify-batch.route.js";
import { settleBatchRouter } from "./routes/settle-batch.route.js";
import { supportedRouter } from "./routes/supported.route.js";
import { riskScanRouter } from "./routes/risk-scan.route.js";
import { payeeReputationRouter } from "./routes/payee-reputation.route.js";
import { analyticsRouter } from "./routes/analytics.route.js";
import { statsRouter } from "./routes/stats.route.js";
import { metricsRouter } from "./routes/metrics.route.js";
import { auditRouter } from "./routes/audit.route.js";
import { discoveryRouter } from "./routes/discovery.route.js";
import { errorMiddleware } from "./middleware/error.middleware.js";
import { httpRequestDuration, httpRequestsTotal } from "../core/metrics/metrics.service.js";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  // Production sits behind Caddy (see Caddyfile/docker-compose.yml) — one
  // reverse-proxy hop. Without this, every request's req.ip resolves to
  // Caddy's own address inside the Docker network, which would collapse the
  // per-IP rate limiters below into one shared bucket for all real clients
  // instead of limiting each one independently.
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "256kb" }));
  app.use(pinoHttp({ logger }));

  // No auth here relies on cookies/sessions (API keys are a header, checked
  // per-route), so a wildcard origin is safe — this just lets the public
  // dashboard (served from a different origin) read responses in-browser.
  app.use((_req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key");
    next();
  });
  app.options("*", (_req, res) => res.sendStatus(204));

  // Records duration/count per request using the matched route TEMPLATE
  // (e.g. "/analytics/:payTo"), never the raw path — raw addresses/ids in
  // labels would give Prometheus unbounded cardinality. req.route is only
  // populated after routing resolves, so this reads it on `res.finish`.
  app.use((req, res, next) => {
    const start = process.hrtime.bigint();
    res.on("finish", () => {
      const route = req.route?.path ?? (res.statusCode === 404 ? "unmatched" : "unknown");
      const labels = { method: req.method, route, status_code: String(res.statusCode) };
      httpRequestsTotal.inc(labels);
      httpRequestDuration.observe(labels, Number(process.hrtime.bigint() - start) / 1e9);
    });
    next();
  });

  app.get("/healthz", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.use(verifyRouter);
  app.use(settleRouter);
  app.use(verifyBatchRouter);
  app.use(settleBatchRouter);
  app.use(supportedRouter);
  app.use(riskScanRouter);
  app.use(payeeReputationRouter);
  app.use(statsRouter);
  app.use(analyticsRouter);
  app.use(metricsRouter);
  app.use(auditRouter);
  app.use(discoveryRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: "not found" });
  });

  app.use(errorMiddleware);

  return app;
}
