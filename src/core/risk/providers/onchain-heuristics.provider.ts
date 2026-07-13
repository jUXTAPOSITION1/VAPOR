import type { PublicClient } from "viem";

export interface OnChainSignal {
  isContract: boolean;
  transactionCount: number;
  nativeBalanceWei: bigint;
}

/**
 * Pure protocol-level facts about an address, sourced directly from the
 * chain via standard JSON-RPC calls (eth_getCode, eth_getTransactionCount,
 * eth_getBalance) — no third-party API, no indexer, works against any RPC
 * endpoint for any EVM chain. This is the risk signal VAPOR can always
 * compute, even with no reputation-intelligence provider configured.
 */
export async function fetchOnChainSignal(
  client: PublicClient,
  address: `0x${string}`
): Promise<OnChainSignal> {
  const [bytecode, transactionCount, nativeBalanceWei] = await Promise.all([
    client.getCode({ address }),
    client.getTransactionCount({ address }),
    client.getBalance({ address }),
  ]);

  return {
    isContract: !!bytecode && bytecode !== "0x",
    transactionCount,
    nativeBalanceWei,
  };
}
