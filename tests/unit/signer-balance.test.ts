import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NetworkConfig } from "../../src/config/networks.js";

const { mockActiveNetworks, mockGetWalletClient, mockGetPublicClient, mockLoggerWarn } = vi.hoisted(() => ({
  mockActiveNetworks: vi.fn(),
  mockGetWalletClient: vi.fn(),
  mockGetPublicClient: vi.fn(),
  mockLoggerWarn: vi.fn(),
}));

vi.mock("../../src/config/networks.js", () => ({
  activeNetworks: (...args: unknown[]) => mockActiveNetworks(...args),
}));
vi.mock("../../src/blockchain/clients/chain.client.js", () => ({
  getWalletClient: (...args: unknown[]) => mockGetWalletClient(...args),
  getPublicClient: (...args: unknown[]) => mockGetPublicClient(...args),
}));
vi.mock("../../src/utils/logger.js", () => ({
  logger: { warn: mockLoggerWarn, error: vi.fn() },
}));
vi.mock("../../src/config/index.js", () => ({
  config: { signerLowBalanceEth: 0.01 },
}));

const { sweepSignerBalances, signerBalanceGauge } = await import("../../src/core/signer/signer-balance.service.js");

const NETWORK = { caip2: "eip155:8453" } as NetworkConfig;

describe("sweepSignerBalances", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signerBalanceGauge.reset();
    mockActiveNetworks.mockReturnValue([NETWORK]);
  });

  it("skips networks with no configured signer", async () => {
    mockGetWalletClient.mockReturnValue(undefined);

    await sweepSignerBalances();

    expect(mockGetPublicClient).not.toHaveBeenCalled();
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });

  it("does not warn when balance is comfortably above the threshold", async () => {
    mockGetWalletClient.mockReturnValue({ account: { address: "0xabc" } });
    mockGetPublicClient.mockReturnValue({ getBalance: vi.fn().mockResolvedValue(10n ** 18n) }); // 1 ETH

    await sweepSignerBalances();

    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });

  it("warns when balance drops below the configured threshold", async () => {
    mockGetWalletClient.mockReturnValue({ account: { address: "0xabc" } });
    mockGetPublicClient.mockReturnValue({ getBalance: vi.fn().mockResolvedValue(10n ** 15n) }); // 0.001 ETH

    await sweepSignerBalances();

    expect(mockLoggerWarn).toHaveBeenCalledOnce();
  });

  it("checking one network never throws even if its RPC call fails", async () => {
    mockGetWalletClient.mockReturnValue({ account: { address: "0xabc" } });
    mockGetPublicClient.mockReturnValue({ getBalance: vi.fn().mockRejectedValue(new Error("rpc down")) });

    await expect(sweepSignerBalances()).resolves.toBeUndefined();
  });
});
