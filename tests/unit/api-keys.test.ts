import { describe, expect, it, vi } from "vitest";
import { parseApiKeys } from "../../src/config/api-keys.js";

const PAY_TO = "0x1111111111111111111111111111111111111111";

describe("parseApiKeys", () => {
  it("returns an empty array for an empty string", () => {
    expect(parseApiKeys("")).toEqual([]);
  });

  it("parses a flat comma-separated list as unscoped keys (backward compatible)", () => {
    expect(parseApiKeys("key-one,key-two")).toEqual([{ key: "key-one" }, { key: "key-two" }]);
  });

  it("trims whitespace and drops empty entries", () => {
    expect(parseApiKeys(" key-one , ,key-two,")).toEqual([{ key: "key-one" }, { key: "key-two" }]);
  });

  it("parses a payTo-scoped key", () => {
    const [entry] = parseApiKeys(`key-one|${PAY_TO}`);
    expect(entry).toEqual({ key: "key-one", payTo: PAY_TO });
  });

  it("checksum-normalizes a lowercase payTo", () => {
    const [entry] = parseApiKeys(`key-one|${PAY_TO.toLowerCase()}`);
    expect(entry?.payTo).toBe(PAY_TO);
  });

  it("parses an expiresAt-only key (empty payTo slot)", () => {
    const [entry] = parseApiKeys("key-one||2027-01-01T00:00:00Z");
    expect(entry?.payTo).toBeUndefined();
    expect(entry?.expiresAt).toEqual(new Date("2027-01-01T00:00:00Z"));
  });

  it("parses a key with both payTo and expiresAt", () => {
    const [entry] = parseApiKeys(`key-one|${PAY_TO}|2027-01-01T00:00:00Z`);
    expect(entry).toEqual({ key: "key-one", payTo: PAY_TO, expiresAt: new Date("2027-01-01T00:00:00Z") });
  });

  it("exits the process on an invalid payTo address", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    parseApiKeys("key-one|not-an-address");

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("exits the process on an invalid expiresAt date", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    parseApiKeys("key-one||not-a-date");

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
