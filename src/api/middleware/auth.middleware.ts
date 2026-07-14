import type { NextFunction, Request, Response } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { config } from "../../config/index.js";
import type { ApiKeyEntry } from "../../config/api-keys.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Locals {
      /** Set by requireApiKey once a key matches. Absent entirely when no
       * API_KEYS are configured (open mode) — routes must treat "absent"
       * the same as "unscoped", not as "nothing matched". */
      apiKeyScope?: Pick<ApiKeyEntry, "payTo">;
    }
  }
}

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

function isExpired(entry: ApiKeyEntry): boolean {
  return entry.expiresAt !== undefined && entry.expiresAt.getTime() <= Date.now();
}

/**
 * Gates a payee's own analytics/audit-export endpoints (and /metrics)
 * behind an API key. Deliberately NOT applied to /verify, /settle, or
 * /supported — those are called by resource servers as part of the open
 * x402 protocol handshake and must stay unauthenticated to work at all.
 *
 * If no API keys are configured, the facilitator is running in open mode
 * (e.g. local development) and every request passes.
 *
 * Each configured key may optionally be scoped to one payTo address (see
 * config/api-keys.ts) — a key scoped this way can only see its own payee's
 * analytics/audit data, not another payee's sharing the same facilitator.
 * The matched entry's scope is recorded on res.locals.apiKeyScope so route
 * handlers can enforce it once they know the specific payTo being
 * requested (this middleware runs before Express extracts route params, so
 * it can authenticate the key but can't yet check it against a :payTo).
 *
 * Checking multiple configured keys with .find() still short-circuits on
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
  const matched =
    provided !== undefined
      ? config.apiKeys.find((entry) => safeEqual(provided, entry.key) && !isExpired(entry))
      : undefined;
  if (!matched) {
    res.status(401).json({ error: "missing or invalid API key" });
    return;
  }
  res.locals.apiKeyScope = { payTo: matched.payTo };
  next();
}

/** True when the matched key (if any) is allowed to see the given payTo's
 * data — an unscoped key (or no keys configured at all) is allowed
 * everywhere; a payTo-scoped key is allowed only for its own address.
 * `payTo` should already be checksum-normalized by the caller (both sides
 * of config/api-keys.ts's parsing and viem's getAddress agree on
 * checksum casing, so this is a plain string compare, not case-insensitive). */
export function isPayeeAllowed(res: Response, payTo: `0x${string}`): boolean {
  const scope = res.locals.apiKeyScope;
  if (!scope?.payTo) return true;
  return scope.payTo === payTo;
}

/** True when the matched key (if any) is unscoped — the only kind /metrics
 * accepts, since it's facility-wide operator data rather than anything
 * belonging to one payee. No keys configured at all also counts as
 * unscoped (open mode already lets everything through). */
export function isUnscopedKey(res: Response): boolean {
  return !res.locals.apiKeyScope?.payTo;
}
