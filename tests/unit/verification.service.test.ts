import { describe, expect, it, vi, beforeEach } from "vitest";
import type { PaymentPayload, PaymentRequirements, RiskAssessment } from "../../src/types/x402.js";

// verifyPayment's own real signature-recovery/RPC dependencies are mocked
// here — this file's job is verifyPayment's OWN branching logic (in
// particular, that an infra failure degrades to a clean recorded result
// instead of throwing), not viem/EIP-3009 mechanics already covered
// elsewhere (signature-split.test.ts, rpc-failover.test.ts).
const { mockRecoverAuthorizationSigner, mockGetPublicClient, mockReadContract, mockScanAddress } = vi.hoisted(() => ({
  mockRecoverAuthorizationSigner: vi.fn(),
  mockGetPublicClient: vi.fn(),
  mockReadContract: vi.fn(),
  mockScanAddress: vi.fn(),
}));

vi.mock("../../src/utils/signature.js", () => ({
  recoverAuthorizationSigner: (...args: unknown[]) => mockRecoverAuthorizationSigner(...args),
}));
vi.mock("../../src/blockchain/clients/chain.client.js", () => ({
  getPublicClient: (...args: unknown[]) => mockGetPublicClient(...args),
}));
vi.mock("../../src/core/risk/risk-scanner.service.js", () => ({
  scanAddress: (...args: unknown[]) => mockScanAddress(...args),
}));

const { verifyPayment } = await import("../../src/core/verification/verification.service.js");

const PAYER = "0x1111111111111111111111111111111111111111" as const;
const PAY_TO = "0x2222222222222222222222222222222222222222" as const;
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;

const requirements: PaymentRequirements = {
  scheme: "exact",
  network: "eip155:8453",
  maxAmountRequired: "1000000",
  resource: "https://example.com/resource",
  payTo: PAY_TO,
  asset: USDC,
};

function payload(): PaymentPayload {
  const now = Math.floor(Date.now() / 1000);
  return {
    x402Version: 2,
    scheme: "exact",
    network: "eip155:8453",
    payload: {
      signature: `0x${"11".repeat(65)}` as `0x${string}`,
      authorization: {
        from: PAYER,
        to: PAY_TO,
        value: "1000000",
        validAfter: String(now - 60),
        validBefore: String(now + 60),
        nonce: `0x${"aa".repeat(32)}` as `0x${string}`,
      },
    },
  };
}

const CLEAN_RISK: RiskAssessment = { score: 5, band: "low", reasons: [], checkedAt: new Date().toISOString() };

describe("verifyPayment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecoverAuthorizationSigner.mockResolvedValue(PAYER);
    mockGetPublicClient.mockReturnValue({ readContract: mockReadContract });
    // authorizationState -> false (not used), balanceOf -> plenty
    mockReadContract.mockImplementation(({ functionName }: { functionName: string }) =>
      functionName === "authorizationState" ? Promise.resolve(false) : Promise.resolve(10_000_000n)
    );
    mockScanAddress.mockResolvedValue(CLEAN_RISK);
  });

  it("returns isValid true for a clean payment with a healthy RPC and risk scan", async () => {
    const result = await verifyPayment(payload(), requirements);
    expect(result.isValid).toBe(true);
    expect(result.payer).toBe(PAYER);
    expect(result.riskAssessment).toEqual(CLEAN_RISK);
  });

  it("degrades to a clean recorded invalid result — not a throw — when the on-chain state read fails", async () => {
    mockReadContract.mockRejectedValue(new Error("RPC timeout"));

    const result = await verifyPayment(payload(), requirements);

    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toMatch(/RPC error/i);
    // The risk scan must never even be attempted once ground truth (replay/
    // balance) couldn't be established — nothing below it can substitute.
    expect(mockScanAddress).not.toHaveBeenCalled();
  });

  it("degrades to a clean recorded invalid result — not a throw — when getPublicClient itself throws (e.g. no RPC URL configured)", async () => {
    mockGetPublicClient.mockImplementation(() => {
      throw new Error("No RPC URL configured for eip155:8453 (expected env var BASE_MAINNET_RPC_URL)");
    });

    const result = await verifyPayment(payload(), requirements);

    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toMatch(/RPC error/i);
  });

  it("still returns isValid true (no riskAssessment) — not a throw — when the risk scan itself fails", async () => {
    mockScanAddress.mockRejectedValue(new Error("risk scan RPC failure"));

    const result = await verifyPayment(payload(), requirements);

    expect(result.isValid).toBe(true);
    expect(result.payer).toBe(PAYER);
    expect(result.riskAssessment).toBeUndefined();
  });

  it("still denies on a genuine policy rejection when the risk scan succeeds", async () => {
    mockScanAddress.mockResolvedValue({ ...CLEAN_RISK, score: 99, band: "high" });
    const requirementsWithPolicy: PaymentRequirements = {
      ...requirements,
      extra: { policy: { maxRiskScore: 10 } },
    };

    const result = await verifyPayment(payload(), requirementsWithPolicy);

    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toMatch(/risk score/i);
  });

  it("rejects an already-used authorization nonce without ever calling the risk scanner", async () => {
    mockReadContract.mockImplementation(({ functionName }: { functionName: string }) =>
      functionName === "authorizationState" ? Promise.resolve(true) : Promise.resolve(10_000_000n)
    );

    const result = await verifyPayment(payload(), requirements);

    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toMatch(/already been used/i);
    expect(mockScanAddress).not.toHaveBeenCalled();
  });

  it("rejects insufficient balance without ever calling the risk scanner", async () => {
    mockReadContract.mockImplementation(({ functionName }: { functionName: string }) =>
      functionName === "authorizationState" ? Promise.resolve(false) : Promise.resolve(0n)
    );

    const result = await verifyPayment(payload(), requirements);

    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toMatch(/balance is insufficient/i);
    expect(mockScanAddress).not.toHaveBeenCalled();
  });
});
