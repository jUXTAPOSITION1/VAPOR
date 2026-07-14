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
import { errorMiddleware } from "./middleware/error.middleware.js";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
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

  app.use((_req, res) => {
    res.status(404).json({ error: "not found" });
  });

  app.use(errorMiddleware);

  return app;
}
