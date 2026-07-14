import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

/**
 * Regression test for a real bug found in this codebase: attaching
 * middleware via `router.use(fn)` makes it run for EVERY request that
 * reaches that router in Express's middleware chain — not just requests
 * that match that router's own route(s) — because every router here is
 * mounted at "/" (app.ts does `app.use(someRouter)` with no path prefix).
 * A blanket `.use()` therefore leaks onto every other route mounted after
 * it (including totally unrelated ones, and even 404s), rather than
 * scoping to its own endpoint. The fix is to pass the middleware as an
 * argument to the specific route definition instead of the router.
 *
 * This is exercised with API_KEYS actually configured (the buggy behavior
 * was invisible in every other test because config.apiKeys is empty in the
 * default test env, which makes requireApiKey a no-op regardless of
 * wiring) — so config/app must be re-imported fresh per test here.
 */
describe("route-scoped middleware (API key gate + rate limiters don't leak across routes)", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it("requires the API key only on /analytics and /metrics, never on unrelated routes", async () => {
    process.env.API_KEYS = "test-secret-key";
    const { createApp } = await import("../../src/api/app.js");
    const app = createApp();

    const withoutKey = await request(app).get("/metrics");
    expect(withoutKey.status).toBe(401);

    const withKey = await request(app).get("/metrics").set("x-api-key", "test-secret-key");
    expect(withKey.status).toBe(200);

    const analyticsNoKey = await request(app).get("/analytics/0x1111111111111111111111111111111111111111");
    expect(analyticsNoKey.status).toBe(401);

    // These never require an API key, with or without one configured —
    // they must NOT inherit /analytics or /metrics's gate.
    const healthz = await request(app).get("/healthz");
    expect(healthz.status).toBe(200);

    const stats = await request(app).get("/stats");
    expect(stats.status).toBe(200);

    const notFound = await request(app).get("/this-route-does-not-exist");
    expect(notFound.status).toBe(404);

    const supported = await request(app).get("/supported");
    expect(supported.status).toBe(200);

    // /discovery/register is the write path (attributable to one payTo) and
    // gets the same gate as /analytics; /discovery/resources is the public
    // Bazaar-client-facing read path and must stay open, same as /supported.
    const registerNoKey = await request(app).post("/discovery/register").send({});
    expect(registerNoKey.status).toBe(401);

    const resourcesNoKey = await request(app).get("/discovery/resources");
    expect(resourcesNoKey.status).toBe(200);
  });

  it("rate-limits only the endpoint a limiter is attached to, not sibling or later routes", async () => {
    process.env.RATE_LIMIT_MAX_SCAN = "1";
    process.env.RATE_LIMIT_WINDOW_MS = "60000";
    const { createApp } = await import("../../src/api/app.js");
    const app = createApp();

    // First risk-scan-shaped request consumes the limit=1 budget on a
    // malformed address (still passes through the limiter before the
    // handler's own validation short-circuits it).
    await request(app).get("/risk-scan/not-an-address?network=eip155:8453");
    const secondScan = await request(app).get("/risk-scan/not-an-address?network=eip155:8453");
    expect(secondScan.status).toBe(429);

    // /risk-scan and /payee-reputation deliberately SHARE one "scan tier"
    // budget per IP (see rate-limit.middleware.ts) — both use the same
    // scanRateLimit instance on purpose, so exhausting it via risk-scan
    // correctly also limits payee-reputation for that same IP. That's by
    // design, not the bug this test guards against.
    const payeeReputation = await request(app).get("/payee-reputation/not-an-address?network=eip155:8453");
    expect(payeeReputation.status).toBe(429);

    // The actual regression: a route with NO rate limiter at all, mounted
    // after risk-scan/payee-reputation in app.ts, must be completely
    // unaffected by their limiter being exhausted. Under the old
    // `router.use(scanRateLimit)` bug, this would incorrectly also 429.
    const healthz = await request(app).get("/healthz");
    expect(healthz.status).toBe(200);
    const stats = await request(app).get("/stats");
    expect(stats.status).toBe(200);
  });
});
