import { describe, expect, it } from "vitest";
import { computeRiskScore } from "../../src/utils/risk-score.js";
import type { OnChainSignal } from "../../src/core/risk/providers/onchain-heuristics.provider.js";

const baseSignal: OnChainSignal = {
  isContract: false,
  transactionCount: 50,
  nativeBalanceWei: 10n ** 18n,
  walletAgeTier: null,
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

  it("gives the full low-tx-count penalty when wallet age is unknown", () => {
    const result = computeRiskScore({ ...baseSignal, transactionCount: 2, walletAgeTier: null }, null);
    expect(result.score).toBe(10);
  });

  it("gives the full low-tx-count penalty for a brand-new wallet", () => {
    const result = computeRiskScore({ ...baseSignal, transactionCount: 2, walletAgeTier: "brand_new" }, null);
    expect(result.score).toBe(10);
  });

  it("gives the full low-tx-count penalty for a wallet aged less than a week", () => {
    const result = computeRiskScore({ ...baseSignal, transactionCount: 2, walletAgeTier: "new" }, null);
    expect(result.score).toBe(10);
  });

  it("reduces the low-tx-count penalty once the wallet is at least a week old", () => {
    const result = computeRiskScore({ ...baseSignal, transactionCount: 2, walletAgeTier: "young" }, null);
    expect(result.score).toBe(4);
    expect(result.reasons.some((r) => r.includes("existed for a while"))).toBe(true);
  });

  it("reduces the low-tx-count penalty for established/mature/veteran wallets alike", () => {
    for (const tier of ["established", "mature", "veteran"] as const) {
      const result = computeRiskScore({ ...baseSignal, transactionCount: 1, walletAgeTier: tier }, null);
      expect(result.score).toBe(4);
    }
  });

  it("never moderates the zero-transaction penalty with wallet age, since age is undefined at zero nonce", () => {
    const result = computeRiskScore({ ...baseSignal, transactionCount: 0, walletAgeTier: null }, null);
    expect(result.score).toBe(25);
  });

  it("surfaces the wallet age tier as its own reason when known, even at a high tx count", () => {
    const result = computeRiskScore({ ...baseSignal, transactionCount: 50, walletAgeTier: "veteran" }, null);
    expect(result.score).toBe(0);
    expect(result.reasons).toContain("wallet age tier: veteran");
  });

  it("adds no age-tier reason when the tier is unknown", () => {
    const result = computeRiskScore({ ...baseSignal, walletAgeTier: null }, null);
    expect(result.reasons.some((r) => r.startsWith("wallet age tier"))).toBe(false);
  });
});
