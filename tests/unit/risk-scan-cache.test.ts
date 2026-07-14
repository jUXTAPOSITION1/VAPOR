import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NetworkConfig } from "../../src/config/networks.js";
import type { OnChainSignal } from "../../src/core/risk/providers/onchain-heuristics.provider.js";

const { mockGetPublicClient, mockFetchOnChainSignal, mockCheckReputation } = vi.hoisted(() => ({
  mockGetPublicClient: vi.fn(),
  mockFetchOnChainSignal: vi.fn(),
  mockCheckReputation: vi.fn(),
}));

vi.mock("../../src/blockchain/clients/chain.client.js", () => ({
  getPublicClient: (...args: unknown[]) => mockGetPublicClient(...args),
}));
vi.mock("../../src/core/risk/providers/onchain-heuristics.provider.js", () => ({
  fetchOnChainSignal: (...args: unknown[]) => mockFetchOnChainSignal(...args),
}));
vi.mock("../../src/core/risk/providers/reputation-intel.provider.js", () => ({
  checkReputation: (...args: unknown[]) => mockCheckReputation(...args),
}));

const { scanAddress, sweepExpiredScanCacheEntries } = await import("../../src/core/risk/risk-scanner.service.js");

const NETWORK_A = { caip2: "eip155:8453", chain: { id: 8453 } } as NetworkConfig;
const NETWORK_B = { caip2: "eip155:1", chain: { id: 1 } } as NetworkConfig;

// The scan cache is real module-level singleton state that outlives any
// one `it()` block for the lifetime of this whole test file — so every
// test uses its OWN address (never reusing one another test already
// touched) to guarantee no cross-test cache hits, rather than relying on
// TTL expiry or test ordering.
let addressCounter = 0;
function freshAddress(): `0x${string}` {
  addressCounter += 1;
  return `0x${addressCounter.toString(16).padStart(40, "0")}` as `0x${string}`;
}

const ON_CHAIN_SIGNAL: OnChainSignal = {
  isContract: false,
  transactionCount: 50,
  nativeBalanceWei: 10n ** 18n,
  walletAgeTier: "veteran",
};

describe("scanAddress caching", () => {
  beforeEach(() => {
    mockGetPublicClient.mockReturnValue({});
    mockFetchOnChainSignal.mockResolvedValue(ON_CHAIN_SIGNAL);
    mockCheckReputation.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("only fetches once for two sequential calls to the same (network, address) within the TTL", async () => {
    const address = freshAddress();
    const first = await scanAddress(NETWORK_A, address);
    const second = await scanAddress(NETWORK_A, address);

    expect(mockFetchOnChainSignal).toHaveBeenCalledTimes(1);
    expect(mockCheckReputation).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it("only fetches once for two genuinely concurrent calls (not just sequential ones)", async () => {
    const address = freshAddress();
    const [first, second] = await Promise.all([scanAddress(NETWORK_A, address), scanAddress(NETWORK_A, address)]);

    expect(mockFetchOnChainSignal).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it("fetches independently for a different address", async () => {
    await scanAddress(NETWORK_A, freshAddress());
    await scanAddress(NETWORK_A, freshAddress());

    expect(mockFetchOnChainSignal).toHaveBeenCalledTimes(2);
  });

  it("fetches independently for the same address on a different network", async () => {
    const address = freshAddress();
    await scanAddress(NETWORK_A, address);
    await scanAddress(NETWORK_B, address);

    expect(mockFetchOnChainSignal).toHaveBeenCalledTimes(2);
  });

  it("does not cache a rejected scan — the next call retries instead of reusing the failure", async () => {
    const address = freshAddress();
    mockFetchOnChainSignal.mockRejectedValueOnce(new Error("rpc down"));
    await expect(scanAddress(NETWORK_A, address)).rejects.toThrow("rpc down");

    // Let the rejection's .catch(() => cache.delete(...)) microtask run.
    await new Promise((r) => setTimeout(r, 0));

    mockFetchOnChainSignal.mockResolvedValueOnce(ON_CHAIN_SIGNAL);
    const result = await scanAddress(NETWORK_A, address);
    expect(result.score).toBeDefined();
    expect(mockFetchOnChainSignal).toHaveBeenCalledTimes(2);
  });

  it("re-fetches after the TTL window has elapsed", async () => {
    const address = freshAddress();
    vi.useFakeTimers();
    try {
      await scanAddress(NETWORK_A, address);
      vi.advanceTimersByTime(3_001);
      await scanAddress(NETWORK_A, address);
      expect(mockFetchOnChainSignal).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("sweepExpiredScanCacheEntries", () => {
  beforeEach(() => {
    mockGetPublicClient.mockReturnValue({});
    mockFetchOnChainSignal.mockResolvedValue(ON_CHAIN_SIGNAL);
    mockCheckReputation.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("purges an entry after it expires, so a subsequent scan re-fetches rather than reusing stale cached state", async () => {
    const address = freshAddress();
    vi.useFakeTimers();
    try {
      await scanAddress(NETWORK_A, address);
      vi.advanceTimersByTime(3_001);
      sweepExpiredScanCacheEntries();
      await scanAddress(NETWORK_A, address);
      expect(mockFetchOnChainSignal).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
