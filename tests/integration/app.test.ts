import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/api/app.js";

const app = createApp();

describe("VAPOR API", () => {
  it("GET /healthz reports ok", async () => {
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("GET /supported lists only networks with a configured RPC URL", async () => {
    const res = await request(app).get("/supported");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("kinds");
    expect(Array.isArray(res.body.kinds)).toBe(true);
  });

  it("POST /verify with a malformed body is rejected before any chain work", async () => {
    const res = await request(app).post("/verify").send({ not: "a valid request" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("POST /settle with a malformed body is rejected before any chain work", async () => {
    const res = await request(app).post("/settle").send({ not: "a valid request" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("POST /settle with extra.async:true still reports a final (non-pending) failure when verification itself fails", async () => {
    // Schema-valid but not cryptographically valid — verification rejects
    // it on the signature check, before settlement ever broadcasts
    // anything, so there's nothing "pending" about this outcome even
    // though async mode was requested.
    const res = await request(app)
      .post("/settle")
      .send({
        x402Version: 1,
        paymentPayload: {
          x402Version: 1,
          scheme: "exact",
          network: "eip155:8453",
          payload: {
            signature: `0x${"11".repeat(65)}`,
            authorization: {
              from: "0x1111111111111111111111111111111111111111",
              to: "0x2222222222222222222222222222222222222222",
              value: "1000000",
              validAfter: "0",
              validBefore: "9999999999",
              nonce: "0xbeef",
            },
          },
        },
        paymentRequirements: {
          scheme: "exact",
          network: "eip155:8453",
          maxAmountRequired: "1000000",
          resource: "https://example.com/resource",
          payTo: "0x2222222222222222222222222222222222222222",
          asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          extra: { async: true },
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.pending).toBeUndefined();
  });

  it("GET /unknown-route returns 404", async () => {
    const res = await request(app).get("/does-not-exist");
    expect(res.status).toBe(404);
  });

  it("GET /stats returns platform-wide aggregates with no payee-specific data", async () => {
    const res = await request(app).get("/stats");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("totals");
    expect(res.body.totals).toHaveProperty("verifyRequests");
    expect(res.body.totals).toHaveProperty("settledVolumeUsd");
    expect(res.body).toHaveProperty("webhookDeliveries");
    expect(res.body).not.toHaveProperty("payTo");
    expect(res.body).not.toHaveProperty("payer");
  });

  it("responses include a wildcard CORS header for public dashboard consumption", async () => {
    const res = await request(app).get("/stats");
    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });

  it("GET /stats/timeseries returns an hourly bucketed points array", async () => {
    const res = await request(app).get("/stats/timeseries?hours=24");
    expect(res.status).toBe(200);
    expect(res.body.hours).toBe(24);
    expect(Array.isArray(res.body.points)).toBe(true);
  });

  it("GET /stats/timeseries clamps an out-of-range hours param to the default", async () => {
    const res = await request(app).get("/stats/timeseries?hours=99999");
    expect(res.status).toBe(200);
    expect(res.body.hours).toBe(48);
  });

  it("GET /payee-reputation/:address rejects a missing/unsupported network before any chain work", async () => {
    const res = await request(app).get("/payee-reputation/0x3333333333333333333333333333333333333333");
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("GET /payee-reputation/:address rejects a malformed address before any chain work", async () => {
    const res = await request(app).get("/payee-reputation/not-an-address?network=eip155:8453");
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("GET /payee-reputation/:address rejects a malformed ?agentId= before any chain work", async () => {
    const res = await request(app).get(
      "/payee-reputation/0x3333333333333333333333333333333333333333?network=eip155:8453&agentId=not-a-number"
    );
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("POST /verify-batch rejects an empty payments array before any chain work", async () => {
    const res = await request(app).post("/verify-batch").send({ x402Version: 1, payments: [] });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("POST /verify-batch rejects more than 10 payments before any chain work", async () => {
    const entry = { not: "a valid payment entry" };
    const res = await request(app)
      .post("/verify-batch")
      .send({ x402Version: 1, payments: Array(11).fill(entry) });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("POST /settle-batch rejects a malformed body before any chain work", async () => {
    const res = await request(app).post("/settle-batch").send({ not: "a valid request" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("GET /metrics exposes Prometheus-format output including this app's own request counter", async () => {
    await request(app).get("/healthz");
    const res = await request(app).get("/metrics");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.text).toContain("vapor_http_requests_total");
    // Route TEMPLATE, not the raw path, keeps label cardinality bounded.
    expect(res.text).toContain('route="/healthz"');
  });

  it("GET /metrics labels a 404 without leaking the raw unmatched path", async () => {
    await request(app).get("/some/random/nonexistent/path");
    const res = await request(app).get("/metrics");
    expect(res.text).not.toContain("/some/random/nonexistent/path");
    expect(res.text).toContain('route="unmatched"');
  });
});
