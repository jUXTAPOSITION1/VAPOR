import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { rateLimit } from "express-rate-limit";

/**
 * Exercises the exact express-rate-limit configuration shape used by
 * paymentRateLimit/scanRateLimit (see rate-limit.middleware.ts) against a
 * throwaway app with a tiny limit, rather than the real config's much
 * larger production defaults — this proves the wiring (429 status, error
 * body, standardHeaders) behaves as expected without needing to fire
 * hundreds of requests against the real app in a unit test.
 */
describe("rate limiting", () => {
  it("allows requests under the limit and rejects the one that exceeds it", async () => {
    const app = express();
    app.use(
      rateLimit({
        windowMs: 60_000,
        limit: 2,
        standardHeaders: "draft-7",
        legacyHeaders: false,
        message: { error: "rate limit exceeded, slow down" },
      })
    );
    app.get("/x", (_req, res) => res.status(200).json({ ok: true }));

    const agent = request(app);
    await agent.get("/x").expect(200);
    await agent.get("/x").expect(200);
    const res = await agent.get("/x");

    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: "rate limit exceeded, slow down" });
  });

  it("exposes standard rate-limit headers so a well-behaved client can back off", async () => {
    const app = express();
    app.use(
      rateLimit({
        windowMs: 60_000,
        limit: 5,
        standardHeaders: "draft-7",
        legacyHeaders: false,
      })
    );
    app.get("/x", (_req, res) => res.status(200).json({ ok: true }));

    const res = await request(app).get("/x");
    expect(res.headers["ratelimit"]).toBeDefined();
  });
});
