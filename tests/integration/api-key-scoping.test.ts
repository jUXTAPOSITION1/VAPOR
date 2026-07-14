import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

/**
 * A flat API_KEYS list gives every key access to every payee's
 * /analytics data and to /metrics — fine for a single-tenant deployment,
 * but a real gap if one facilitator serves several payees, since one
 * payee's key could read another's audit log. Scoping (config/api-keys.ts)
 * lets an operator bind a key to one payTo; these tests exercise that gate
 * end-to-end through the real Express app rather than just the parsing
 * unit (see tests/unit/api-keys.test.ts) or the middleware in isolation.
 */
describe("per-key API scoping", () => {
  const ORIGINAL_ENV = { ...process.env };
  const PAYEE_A = "0x1111111111111111111111111111111111111111";
  const PAYEE_B = "0x2222222222222222222222222222222222222222";

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it("a payTo-scoped key can read its own payee's analytics but not another's", async () => {
    process.env.API_KEYS = `scoped-key|${PAYEE_A}`;
    const { createApp } = await import("../../src/api/app.js");
    const app = createApp();

    const ownData = await request(app).get(`/analytics/${PAYEE_A}`).set("x-api-key", "scoped-key");
    expect(ownData.status).toBe(200);

    const otherData = await request(app).get(`/analytics/${PAYEE_B}`).set("x-api-key", "scoped-key");
    expect(otherData.status).toBe(403);
  });

  it("an unscoped key still reads any payee's analytics (backward compatible)", async () => {
    process.env.API_KEYS = "flat-key";
    const { createApp } = await import("../../src/api/app.js");
    const app = createApp();

    const a = await request(app).get(`/analytics/${PAYEE_A}`).set("x-api-key", "flat-key");
    expect(a.status).toBe(200);
    const b = await request(app).get(`/analytics/${PAYEE_B}`).set("x-api-key", "flat-key");
    expect(b.status).toBe(200);
  });

  it("a payTo-scoped key cannot access /metrics", async () => {
    process.env.API_KEYS = `scoped-key|${PAYEE_A}`;
    const { createApp } = await import("../../src/api/app.js");
    const app = createApp();

    const res = await request(app).get("/metrics").set("x-api-key", "scoped-key");
    expect(res.status).toBe(403);
  });

  it("an unscoped key can access /metrics", async () => {
    process.env.API_KEYS = "flat-key";
    const { createApp } = await import("../../src/api/app.js");
    const app = createApp();

    const res = await request(app).get("/metrics").set("x-api-key", "flat-key");
    expect(res.status).toBe(200);
  });

  it("an expired key is rejected outright, scoped or not", async () => {
    process.env.API_KEYS = "expired-key||2000-01-01T00:00:00Z";
    const { createApp } = await import("../../src/api/app.js");
    const app = createApp();

    const res = await request(app).get(`/analytics/${PAYEE_A}`).set("x-api-key", "expired-key");
    expect(res.status).toBe(401);
  });

  it("the export sibling endpoint enforces the same scope", async () => {
    process.env.API_KEYS = `scoped-key|${PAYEE_A}`;
    const { createApp } = await import("../../src/api/app.js");
    const app = createApp();

    const otherExport = await request(app).get(`/analytics/${PAYEE_B}/export`).set("x-api-key", "scoped-key");
    expect(otherExport.status).toBe(403);
  });
});
