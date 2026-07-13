import { describe, expect, it } from "vitest";
import { splitSignature } from "../../src/core/settlement/settlement.service.js";

describe("splitSignature", () => {
  it("splits a 65-byte signature into r, s, and canonical v", () => {
    const r = "1".repeat(64);
    const s = "2".repeat(64);
    const signature = `0x${r}${s}1b` as const; // 0x1b = 27, already canonical

    const result = splitSignature(signature);
    expect(result.r).toBe(`0x${r}`);
    expect(result.s).toBe(`0x${s}`);
    expect(result.v).toBe(27);
  });

  it("normalizes a 0/1 recovery id up to canonical 27/28", () => {
    const r = "a".repeat(64);
    const s = "b".repeat(64);
    const signature = `0x${r}${s}00` as const; // recovery id 0

    const result = splitSignature(signature);
    expect(result.v).toBe(27);
  });

  it("throws on a malformed (wrong-length) signature", () => {
    expect(() => splitSignature("0x1234" as `0x${string}`)).toThrow();
  });
});
