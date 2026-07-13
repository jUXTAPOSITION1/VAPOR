import type { NextFunction, Request, Response } from "express";
import { config } from "../../config/index.js";

/**
 * Gates a payee's own analytics/audit-export endpoints behind an API key.
 * Deliberately NOT applied to /verify, /settle, or /supported — those are
 * called by resource servers as part of the open x402 protocol handshake
 * and must stay unauthenticated to work at all.
 *
 * If no API keys are configured, the facilitator is running in open mode
 * (e.g. local development) and every request passes.
 */
export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  if (config.apiKeys.length === 0) {
    next();
    return;
  }

  const provided = req.header("x-api-key");
  if (!provided || !config.apiKeys.includes(provided)) {
    res.status(401).json({ error: "missing or invalid API key" });
    return;
  }
  next();
}
