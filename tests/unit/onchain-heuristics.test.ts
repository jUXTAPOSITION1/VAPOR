import { describe, expect, it } from "vitest";
import { fetchOnChainSignal } from "../../src/core/risk/providers/onchain-heuristics.provider.js";
import type { PublicClient } from "viem";

const ADDRESS = "0x1111111111111111111111111111111111111111" as const;
const CURRENT_BLOCK = 20_000_000n;

/** Simulates a wallet whose first-ever transaction landed in
 * `bornAtBlock` — any historical nonce query at or after that block
 * returns a nonzero count, any query before it returns zero. */
function makeFakeClient(opts: {
  currentTxCount: number;
  bornAtBlock?: bigint;
  historicalQueriesThrow?: boolean;
}): PublicClient {
  return {
    getCode: async () => "0x",
    getBalance: async () => 0n,
    getBlockNumber: async () => CURRENT_BLOCK,
    getTransactionCount: async ({ blockNumber }: { blockNumber?: bigint }) => {
      if (blockNumber === undefined) return opts.currentTxCount;
      if (opts.historicalQueriesThrow) throw new Error("historical state not available");
      return opts.bornAtBlock !== undefined && blockNumber >= opts.bornAtBlock ? 5 : 0;
    },
  } as unknown as PublicClient;
}

describe("fetchOnChainSignal — wallet age tiering", () => {
  it("never attempts aging (walletAgeTier stays null) for a zero-nonce wallet", async () => {
    const client = makeFakeClient({ currentTxCount: 0 });
    const signal = await fetchOnChainSignal(client, ADDRESS);
    expect(signal.walletAgeTier).toBeNull();
  });

  it("buckets a wallet active 7 days ago but not 30 days ago as 'young'", async () => {
    // bornAtBlock chosen so the wallet is active-by the 1-day and 7-day
    // checkpoints but not the 30-day/180-day/365-day ones.
    const client = makeFakeClient({ currentTxCount: 5, bornAtBlock: 19_000_000n });
    const signal = await fetchOnChainSignal(client, ADDRESS);
    expect(signal.walletAgeTier).toBe("young");
  });

  it("buckets a wallet already active 365+ days ago as 'veteran'", async () => {
    const client = makeFakeClient({ currentTxCount: 5, bornAtBlock: 1_000_000n });
    const signal = await fetchOnChainSignal(client, ADDRESS);
    expect(signal.walletAgeTier).toBe("veteran");
  });

  it("buckets a wallet with no activity at any checkpoint as 'brand_new'", async () => {
    // bornAtBlock in the future relative to every checkpoint query.
    const client = makeFakeClient({ currentTxCount: 5, bornAtBlock: 19_999_999n });
    const signal = await fetchOnChainSignal(client, ADDRESS);
    expect(signal.walletAgeTier).toBe("brand_new");
  });

  it("degrades to null (not a thrown error) when the RPC can't serve historical state", async () => {
    const client = makeFakeClient({ currentTxCount: 5, historicalQueriesThrow: true });
    const signal = await fetchOnChainSignal(client, ADDRESS);
    expect(signal.walletAgeTier).toBeNull();
  });
});
