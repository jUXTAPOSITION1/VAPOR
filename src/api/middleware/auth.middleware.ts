import type { NextFunction, Request, Response } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { config } from "../../config/index.js";

/** SHA-256 first so the comparison is always between two fixed-length
 * (32-byte) buffers — timingSafeEqual throws on a length mismatch, which a
 * raw variable-length API key comparison couldn't avoid, and the constant-
 * time guarantee only holds between equal-length inputs anyway. This isn't
 * about secrecy of a stored hash (the real keys are already plaintext in
 * config.apiKeys) — purely a length-normalization step so equality can be
 * checked without letting a mismatch's position (or the provided key's raw
 * length) leak through comparison timing. */
function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b));
}

/**
 * Gates a payee's own analytics/audit-export endpoints behind an API key.
 * Deliberately NOT applied to /verify, /settle, or /supported — those are
 * called by resource servers as part of the open x402 protocol handshake
 * and must stay unauthenticated to work at all.
 *
 * If no API keys are configured, the facilitator is running in open mode
 * (e.g. local development) and every request passes.
 *
 * Checking multiple configured keys with .some() still short-circuits on
 * the first match, which leaks which position in the list matched via
 * timing — a much narrower side channel than leaking the key's actual
 * characters (what a plain === or .includes() comparison would do), and
 * not worth the complexity of always comparing against every configured
 * key just to close it.
 */
export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  if (config.apiKeys.length === 0) {
    next();
    return;
  }

  const provided = req.header("x-api-key");
  const matches = provided !== undefined && config.apiKeys.some((key) => safeEqual(provided, key));
  if (!matches) {
    res.status(401).json({ error: "missing or invalid API key" });
    return;
  }
  next();
}
