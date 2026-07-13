import { pino } from "pino";
import { config } from "../config/index.js";

export const logger = pino({
  level: config.logLevel,
  redact: {
    paths: ["*.signature", "*.paymentPayload.payload.signature", "req.headers.authorization"],
    censor: "[redacted]",
  },
});
