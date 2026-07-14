import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PaymentPayload, PaymentRequirements } from "../../src/types/x402.js";

const { mockVerifyPayment, mockGetWalletClient, mockGetPublicClient } = vi.hoisted(() => ({
  mockVerifyPayment: vi.fn(),
  mockGetWalletClient: vi.fn(),
  mockGetPublicClient: vi.fn(),
}));

vi.mock("../../src/core/verification/verification.service.js", () => ({
  verifyPayment: (...args: unknown[]) => mockVerifyPayment(...args),
}));

vi.mock("../../src/blockchain/clients/chain.client.js", () => ({
  getWalletClient: (...args: unknown[]) => mockGetWalletClient(...args),
  getPublicClient: (...args: unknown[]) => mockGetPublicClient(...args),
}));

const { settlePayment, settlePaymentAsync, isAsyncSettlementRequested } = await import(
  "../../src/core/settlement/settlement.service.js"
);

const PAYER = "0x1111111111111111111111111111111111111111" as const;
const PAYEE = "0x2222222222222222222222222222222222222222" as const;
const TX_HASH = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
// 65 bytes (130 hex chars) — splitSignature only cares about shape, not
// cryptographic validity, since verifyPayment (the only thing that
// actually recovers/checks the signature) is mocked out in these tests.
const DUMMY_SIGNATURE = `0x${"11".repeat(65)}` as `0x${string}`;

function makePayload(): PaymentPayload {
  return {
    x402Version: 1,
    scheme: "exact",
    network: "eip155:8453",
    payload: {
      signature: DUMMY_SIGNATURE,
      authorization: {
        from: PAYER,
        to: PAYEE,
        value: "1000000",
        validAfter: "0",
        validBefore: "9999999999",
        nonce: "0xbeef",
      },
    },
  };
}

function makeRequirements(extra?: Record<string, unknown>): PaymentRequirements {
  return {
    scheme: "exact",
    network: "eip155:8453",
    maxAmountRequired: "1000000",
    resource: "https://example.com/resource",
    payTo: PAYEE,
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    extra,
  };
}

describe("isAsyncSettlementRequested", () => {
  it("is true only when extra.async is exactly boolean true", () => {
    expect(isAsyncSettlementRequested({ async: true })).toBe(true);
    expect(isAsyncSettlementRequested({ async: "true" })).toBe(false);
    expect(isAsyncSettlementRequested({ async: false })).toBe(false);
    expect(isAsyncSettlementRequested(undefined)).toBe(false);
    expect(isAsyncSettlementRequested({})).toBe(false);
  });
});

describe("settlePaymentAsync", () => {
  beforeEach(() => {
    mockVerifyPayment.mockReset();
    mockGetWalletClient.mockReset();
    mockGetPublicClient.mockReset();
  });

  it("returns a final (non-pending) failure immediately when verification fails, without ever touching the wallet client", async () => {
    mockVerifyPayment.mockResolvedValue({ isValid: false, invalidReason: "authorization nonce has already been used", payer: PAYER });

    const onResolved = vi.fn();
    const result = await settlePaymentAsync(makePayload(), makeRequirements(), onResolved);

    expect(result.pending).toBeUndefined();
    expect(result.success).toBe(false);
    expect(result.errorReason).toBe("authorization nonce has already been used");
    expect(mockGetWalletClient).not.toHaveBeenCalled();
    expect(onResolved).not.toHaveBeenCalled();
  });

  it("returns pending:true immediately after broadcast, without waiting for the receipt", async () => {
    mockVerifyPayment.mockResolvedValue({ isValid: true, payer: PAYER });

    let resolveReceipt!: (value: { status: string }) => void;
    const receiptPromise = new Promise<{ status: string }>((resolve) => {
      resolveReceipt = resolve;
    });

    const writeContract = vi.fn().mockResolvedValue(TX_HASH);
    mockGetWalletClient.mockReturnValue({ account: { address: PAYER }, writeContract });
    const waitForTransactionReceipt = vi.fn().mockReturnValue(receiptPromise);
    mockGetPublicClient.mockReturnValue({ waitForTransactionReceipt });

    const onResolved = vi.fn();
    const result = await settlePaymentAsync(makePayload(), makeRequirements({ async: true }), onResolved);

    expect(result).toEqual({
      success: false,
      pending: true,
      payer: PAYER,
      transaction: TX_HASH,
      network: "eip155:8453",
      amount: "1000000",
    });
    // The response above returned WITHOUT the receipt ever resolving —
    // proves this path doesn't block on confirmation.
    expect(onResolved).not.toHaveBeenCalled();

    resolveReceipt({ status: "success" });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(onResolved).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, transaction: TX_HASH, payer: PAYER })
    );
  });

  it("resolves onResolved with a failure when the broadcast transaction reverts on-chain", async () => {
    mockVerifyPayment.mockResolvedValue({ isValid: true, payer: PAYER });
    mockGetWalletClient.mockReturnValue({
      account: { address: PAYER },
      writeContract: vi.fn().mockResolvedValue(TX_HASH),
    });
    mockGetPublicClient.mockReturnValue({
      waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: "reverted" }),
    });

    const onResolved = vi.fn();
    await settlePaymentAsync(makePayload(), makeRequirements({ async: true }), onResolved);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(onResolved).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, errorReason: "settlement transaction reverted on-chain" })
    );
  });
});

describe("settlePayment (sync)", () => {
  beforeEach(() => {
    mockVerifyPayment.mockReset();
    mockGetWalletClient.mockReset();
    mockGetPublicClient.mockReset();
  });

  it("still blocks until confirmation and reports success:true only once confirmed", async () => {
    mockVerifyPayment.mockResolvedValue({ isValid: true, payer: PAYER });
    mockGetWalletClient.mockReturnValue({
      account: { address: PAYER },
      writeContract: vi.fn().mockResolvedValue(TX_HASH),
    });
    mockGetPublicClient.mockReturnValue({
      waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: "success" }),
    });

    const result = await settlePayment(makePayload(), makeRequirements());
    expect(result).toEqual({ success: true, payer: PAYER, transaction: TX_HASH, network: "eip155:8453", amount: "1000000" });
    expect(result.pending).toBeUndefined();
  });
});
