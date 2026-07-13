import express from "express";
import { pinoHttp } from "pino-http";
import { logger } from "../utils/logger.js";
import { verifyRouter } from "./routes/verify.route.js";
import { settleRouter } from "./routes/settle.route.js";
import { supportedRouter } from "./routes/supported.route.js";
import { riskScanRouter } from "./routes/risk-scan.route.js";
import { analyticsRouter } from "./routes/analytics.route.js";
import { errorMiddleware } from "./middleware/error.middleware.js";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "256kb" }));
  app.use(pinoHttp({ logger }));

  app.get("/healthz", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.use(verifyRouter);
  app.use(settleRouter);
  app.use(supportedRouter);
  app.use(riskScanRouter);
  app.use(analyticsRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: "not found" });
  });

  app.use(errorMiddleware);

  return app;
}
