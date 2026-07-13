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
});
