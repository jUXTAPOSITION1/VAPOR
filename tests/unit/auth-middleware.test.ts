import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("requireApiKey", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  function fakeReqRes(headerValue?: string) {
    const req = { header: (name: string) => (name === "x-api-key" ? headerValue : undefined) } as any;
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const res = { status, locals: {} } as any;
    const next = vi.fn();
    return { req, res, next, status, json };
  }

  it("passes every request through when no API keys are configured", async () => {
    delete process.env.API_KEYS;
    const { requireApiKey } = await import("../../src/api/middleware/auth.middleware.js");
    const { req, res, next, status } = fakeReqRes(undefined);

    requireApiKey(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(status).not.toHaveBeenCalled();
  });

  it("rejects a missing key when keys ARE configured", async () => {
    process.env.API_KEYS = "correct-key";
    const { requireApiKey } = await import("../../src/api/middleware/auth.middleware.js");
    const { req, res, next, status, json } = fakeReqRes(undefined);

    requireApiKey(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: "missing or invalid API key" });
  });

  it("rejects a wrong key, including one that shares a long common prefix", async () => {
    process.env.API_KEYS = "correct-key-0123456789";
    const { requireApiKey } = await import("../../src/api/middleware/auth.middleware.js");
    const { req, res, next, status } = fakeReqRes("correct-key-0123456780");

    requireApiKey(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
  });

  it("accepts the exact configured key", async () => {
    process.env.API_KEYS = "correct-key";
    const { requireApiKey } = await import("../../src/api/middleware/auth.middleware.js");
    const { req, res, next, status } = fakeReqRes("correct-key");

    requireApiKey(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(status).not.toHaveBeenCalled();
  });

  it("accepts any one of several comma-separated configured keys", async () => {
    process.env.API_KEYS = "key-one,key-two,key-three";
    const { requireApiKey } = await import("../../src/api/middleware/auth.middleware.js");

    for (const key of ["key-one", "key-two", "key-three"]) {
      const { req, res, next } = fakeReqRes(key);
      requireApiKey(req, res, next);
      expect(next).toHaveBeenCalledOnce();
    }
  });

  it("rejects keys of a completely different length than any configured key", async () => {
    process.env.API_KEYS = "short";
    const { requireApiKey } = await import("../../src/api/middleware/auth.middleware.js");
    const { req, res, next, status } = fakeReqRes("a-much-much-longer-provided-key-value");

    requireApiKey(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
  });
});
