import { describe, expect, it } from "vitest";
import { computeRiskScore } from "../../src/utils/risk-score.js";
import type { OnChainSignal } from "../../src/core/risk/providers/onchain-heuristics.provider.js";

const baseSignal: OnChainSignal = {
  isContract: false,
  transactionCount: 50,
  nativeBalanceWei: 10n ** 18n,
};

describe("computeRiskScore", () => {
  it("scores an established, unflagged EOA as low risk", () => {
    const result = computeRiskScore(baseSignal, null);
    expect(result.score).toBe(0);
    expect(result.band).toBe("low");
    expect(result.reasons).toHaveLength(0);
  });

  it("penalizes zero prior transactions", () => {
    const result = computeRiskScore({ ...baseSignal, transactionCount: 0 }, null);
    expect(result.score).toBe(25);
    expect(result.band).toBe("medium");
    expect(result.reasons).toContain("address has zero prior transactions");
  });

  it("penalizes low (but nonzero) transaction counts less than zero", () => {
    const result = computeRiskScore({ ...baseSignal, transactionCount: 2 }, null);
    expect(result.score).toBe(10);
  });

  it("dominates the score when the reputation provider flags the address", () => {
    const result = computeRiskScore(baseSignal, { flagged: true, categories: ["phishing"] });
    expect(result.score).toBe(60);
    expect(result.band).toBe("high");
    expect(result.reasons[0]).toContain("phishing");
  });

  it("combines reputation flag and zero-history into severe band", () => {
    const result = computeRiskScore({ ...baseSignal, transactionCount: 0 }, { flagged: true, categories: [] });
    expect(result.score).toBe(85);
    expect(result.band).toBe("severe");
  });

  it("caps the score at 100", () => {
    const result = computeRiskScore(
      { ...baseSignal, transactionCount: 0, isContract: true },
      { flagged: true, categories: ["a", "b", "c"] }
    );
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("notes contract addresses as informational, not penalized", () => {
    const asContract = computeRiskScore({ ...baseSignal, isContract: true }, null);
    const asEoa = computeRiskScore({ ...baseSignal, isContract: false }, null);
    expect(asContract.score).toBe(asEoa.score);
    expect(asContract.reasons).toContain("payer address is a contract, not an externally-owned account");
  });

  it("is deterministic for identical inputs", () => {
    const a = computeRiskScore(baseSignal, { flagged: false, categories: [] });
    const b = computeRiskScore(baseSignal, { flagged: false, categories: [] });
    expect(a.score).toBe(b.score);
    expect(a.band).toBe(b.band);
    expect(a.reasons).toEqual(b.reasons);
  });
});
