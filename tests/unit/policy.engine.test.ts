import { describe, expect, it } from "vitest";
import { evaluatePolicy } from "../../src/core/policy/policy.engine.js";
import type { PaymentRequirements, RiskAssessment } from "../../src/types/x402.js";

const payer = "0x1111111111111111111111111111111111111111" as const;

const baseRequirements: PaymentRequirements = {
  scheme: "exact",
  network: "eip155:8453",
  maxAmountRequired: "1000000",
  resource: "https://example.com/resource",
  payTo: "0x2222222222222222222222222222222222222222",
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
};

const cleanRisk: RiskAssessment = { score: 5, band: "low", reasons: [], checkedAt: new Date().toISOString() };

describe("evaluatePolicy", () => {
  it("allows a low-risk payment within default thresholds", () => {
    const decision = evaluatePolicy(baseRequirements, cleanRisk, 1_000_000n, 6, payer);
    expect(decision.allowed).toBe(true);
  });

  it("denies when the risk score exceeds the payee's configured maximum", () => {
    const requirements: PaymentRequirements = { ...baseRequirements, extra: { policy: { maxRiskScore: 10 } } };
    const risk: RiskAssessment = { ...cleanRisk, score: 50 };
    const decision = evaluatePolicy(requirements, risk, 1_000_000n, 6, payer);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/risk score/);
  });

  it("denies when the amount exceeds the payee's configured maximum", () => {
    const requirements: PaymentRequirements = { ...baseRequirements, extra: { policy: { maxAmountUsd: 0.5 } } };
    const decision = evaluatePolicy(requirements, cleanRisk, 1_000_000n, 6, payer);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/exceeds policy maximum/);
  });

  it("denies when the amount is below the payee's configured minimum", () => {
    const requirements: PaymentRequirements = { ...baseRequirements, extra: { policy: { minAmountUsd: 5 } } };
    const decision = evaluatePolicy(requirements, cleanRisk, 1_000_000n, 6, payer);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/below policy minimum/);
  });

  it("denies a payer on the payee's deny list regardless of risk score", () => {
    const requirements: PaymentRequirements = { ...baseRequirements, extra: { policy: { denyList: [payer] } } };
    const decision = evaluatePolicy(requirements, cleanRisk, 1_000_000n, 6, payer);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/deny list/);
  });

  it("ignores malformed addresses in a deny list instead of throwing", () => {
    const requirements: PaymentRequirements = {
      ...baseRequirements,
      extra: { policy: { denyList: ["not-an-address"] } },
    };
    const decision = evaluatePolicy(requirements, cleanRisk, 1_000_000n, 6, payer);
    expect(decision.allowed).toBe(true);
  });
});
