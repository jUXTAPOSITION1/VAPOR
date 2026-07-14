import { describe, expect, it } from "vitest";
import { computePayeeReputation } from "../../src/utils/payee-reputation-score.js";
import type { OnChainSignal } from "../../src/core/risk/providers/onchain-heuristics.provider.js";

const payTo = "0x3333333333333333333333333333333333333333" as const;

const baseOnChain: OnChainSignal = {
  isContract: false,
  transactionCount: 50,
  nativeBalanceWei: 10n ** 18n,
};

const noHistory = {
  totalVerifyRequests: 0,
  totalSettlements: 0,
  settlementSuccessRate: null,
  totalSettledVolumeUsd: 0,
  firstSeenAt: null,
};

describe("computePayeeReputation", () => {
  it("scores a brand-new payee with no history as 'new' and zero score", () => {
    const result = computePayeeReputation(payTo, baseOnChain, null, noHistory);
    expect(result.score).toBe(0);
    expect(result.band).toBe("new");
    expect(result.flaggedByReputationProvider).toBe(false);
  });

  it("rewards completed settlements", () => {
    const result = computePayeeReputation(payTo, baseOnChain, null, {
      ...noHistory,
      totalSettlements: 5,
    });
    expect(result.score).toBe(25);
    expect(result.band).toBe("emerging");
  });

  it("rewards higher settlement counts progressively", () => {
    const at10 = computePayeeReputation(payTo, baseOnChain, null, { ...noHistory, totalSettlements: 10 });
    const at100 = computePayeeReputation(payTo, baseOnChain, null, { ...noHistory, totalSettlements: 100 });
    expect(at10.score).toBe(45);
    expect(at100.score).toBe(65);
    expect(at100.band).toBe("established");
  });

  it("rewards tenure", () => {
    const oldDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
    const result = computePayeeReputation(payTo, baseOnChain, null, {
      ...noHistory,
      totalSettlements: 100,
      firstSeenAt: oldDate,
    });
    expect(result.score).toBe(90);
    expect(result.band).toBe("veteran");
  });

  it("rewards a high settlement success rate only with enough sample size", () => {
    const tooFewRequests = computePayeeReputation(payTo, baseOnChain, null, {
      ...noHistory,
      totalVerifyRequests: 2,
      totalSettlements: 2,
      settlementSuccessRate: 1,
    });
    const enoughRequests = computePayeeReputation(payTo, baseOnChain, null, {
      ...noHistory,
      totalVerifyRequests: 10,
      totalSettlements: 10,
      settlementSuccessRate: 1,
    });
    expect(tooFewRequests.reasons.some((r) => r.includes("success rate"))).toBe(false);
    expect(enoughRequests.reasons.some((r) => r.includes("success rate"))).toBe(true);
  });

  it("caps the score low when flagged by a reputation provider, regardless of history", () => {
    const oldDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
    const result = computePayeeReputation(payTo, baseOnChain, { flagged: true, categories: ["scam"] }, {
      ...noHistory,
      totalSettlements: 500,
      firstSeenAt: oldDate,
    });
    expect(result.score).toBeLessThanOrEqual(10);
    expect(result.band).toBe("new");
    expect(result.flaggedByReputationProvider).toBe(true);
    expect(result.reasons[0]).toContain("scam");
  });

  it("never exceeds a score of 100", () => {
    const oldDate = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
    const result = computePayeeReputation(payTo, baseOnChain, null, {
      totalVerifyRequests: 1000,
      totalSettlements: 1000,
      settlementSuccessRate: 1,
      totalSettledVolumeUsd: 100000,
      firstSeenAt: oldDate,
    });
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("is deterministic for identical inputs", () => {
    const a = computePayeeReputation(payTo, baseOnChain, null, { ...noHistory, totalSettlements: 3 });
    const b = computePayeeReputation(payTo, baseOnChain, null, { ...noHistory, totalSettlements: 3 });
    expect(a.score).toBe(b.score);
    expect(a.band).toBe(b.band);
  });

  it("omits erc8004 entirely when no agentId was supplied", () => {
    const result = computePayeeReputation(payTo, baseOnChain, null, noHistory);
    expect(result.erc8004).toBeUndefined();
  });

  it("bonuses a verified ERC-8004 agent with positive feedback", () => {
    const result = computePayeeReputation(payTo, baseOnChain, null, noHistory, {
      agentId: "42",
      verified: true,
      feedbackCount: 12,
      averageScore: 0.8,
    });
    expect(result.score).toBe(15);
    expect(result.erc8004).toEqual({ agentId: "42", verified: true, feedbackCount: 12, averageScore: 0.8 });
    expect(result.reasons.some((r) => r.includes("ERC-8004"))).toBe(true);
  });

  it("gives no bonus for a verified ERC-8004 agent with zero feedback yet", () => {
    const result = computePayeeReputation(payTo, baseOnChain, null, noHistory, {
      agentId: "42",
      verified: true,
      feedbackCount: 0,
      averageScore: null,
    });
    expect(result.score).toBe(0);
  });

  it("gives no bonus and surfaces the mismatch when the claimed agentId isn't verified", () => {
    const result = computePayeeReputation(payTo, baseOnChain, null, noHistory, {
      agentId: "42",
      verified: false,
      feedbackCount: 0,
      averageScore: null,
    });
    expect(result.score).toBe(0);
    expect(result.erc8004?.verified).toBe(false);
  });
});
