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
});
