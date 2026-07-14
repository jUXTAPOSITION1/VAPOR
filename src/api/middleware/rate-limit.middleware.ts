import { rateLimit } from "express-rate-limit";
import { config } from "../../config/index.js";

/**
 * VAPOR's payment endpoints (/verify, /settle, and their batch siblings) are
 * unauthenticated by protocol necessity — any x402 resource server calls
 * them as part of the open handshake — so there's nothing else standing
 * between them and a flood of requests. Keyed by IP (the only identity
 * available pre-signature-verification); in-memory store, matching this
 * repo's single-instance, no-extra-infra deployment (see webhook.service.ts,
 * docker-compose.yml) — a multi-instance deployment would need a shared
 * store (e.g. Redis) instead.
 *
 * Attach this to the SPECIFIC route (e.g. `router.post("/verify",
 * paymentRateLimit, ...)`), never via `router.use(paymentRateLimit)`.
 * Every router in this API is mounted at "/" (see app.ts), so a
 * router-level `.use()` would run unconditionally for every request that
 * reaches that router while Express looks for a matching route — including
 * requests bound for entirely different endpoints mounted later, and even
 * 404s — silently turning a per-endpoint limit into a de facto global one.
 * (This exact bug shipped once and was caught by
 * tests/integration/route-scoped-middleware.test.ts.)
 */
export const paymentRateLimit = rateLimit({
  windowMs: config.rateLimit.windowMs,
  limit: config.rateLimit.maxPayment,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "rate limit exceeded, slow down" },
});

/**
 * /risk-scan and /payee-reputation are free, unauthenticated, RPC-cost- and
 * (optionally) reputation-vendor-cost-bearing reads with no payment gating
 * them at all — the cheapest possible DoS/cost-abuse target on this
 * facilitator, so they get the tighter of the two limits. Both routes
 * deliberately share this ONE instance (and therefore one combined per-IP
 * budget) rather than getting an independent limiter each — the concern is
 * total RPC/vendor-cost exposure per caller across either free scan
 * endpoint, not per-route fairness. Same route-level (never router-level)
 * attachment rule as paymentRateLimit above.
 */
export const scanRateLimit = rateLimit({
  windowMs: config.rateLimit.windowMs,
  limit: config.rateLimit.maxScan,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "rate limit exceeded, slow down" },
});

/**
 * GET /discovery/resources[/search] — public, unauthenticated reads (any
 * x402 Bazaar client needs to query these with no credential), but a plain
 * DB read rather than an RPC- or vendor-cost-bearing one like scanRateLimit's
 * two routes, so it gets its own instance instead of sharing that one's
 * budget (see scanRateLimit's docstring on why it's deliberately scoped to
 * exactly those two routes). Same per-IP, in-memory, route-scoped-only
 * attachment rule as the limiters above.
 */
export const discoveryRateLimit = rateLimit({
  windowMs: config.rateLimit.windowMs,
  limit: config.rateLimit.maxScan,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "rate limit exceeded, slow down" },
});
