import type { PublicClient } from "viem";

export type WalletAgeTier = "brand_new" | "new" | "young" | "established" | "mature" | "veteran";

export interface OnChainSignal {
  isContract: boolean;
  transactionCount: number;
  nativeBalanceWei: bigint;
  /**
   * How long this address has been actively sending transactions, or
   * `null` when it can't be determined. Two distinct reasons it can be
   * null, both real and both worth knowing:
   *   - `transactionCount === 0`: nonce-based aging can never date a wallet
   *     that has never sent anything (receiving funds doesn't move the
   *     nonce), regardless of how long ago it was funded.
   *   - the RPC endpoint doesn't serve historical state (most free/public
   *     full nodes only keep recent blocks; eth_getTransactionCount at an
   *     old block needs an archive node) — this degrades silently to null
   *     rather than failing the whole risk scan.
   */
  walletAgeTier: WalletAgeTier | null;
}

// Base mainnet targets ~2s blocks. Coarse, cheap-to-check tiers rather than
// a true binary search: a handful of PARALLEL historical nonce checks
// bounds this to one extra RPC round-trip alongside the existing ones,
// instead of the ~26 sequential calls a real binary search over Base's
// multi-million block height would need.
const BLOCKS_PER_SECOND = 0.5;
const AGE_CHECKPOINTS: { tier: WalletAgeTier; ageSeconds: number }[] = [
  { tier: "new", ageSeconds: 60 * 60 * 24 }, // 1 day
  { tier: "young", ageSeconds: 60 * 60 * 24 * 7 }, // 1 week
  { tier: "established", ageSeconds: 60 * 60 * 24 * 30 }, // 30 days
  { tier: "mature", ageSeconds: 60 * 60 * 24 * 180 }, // 180 days
  { tier: "veteran", ageSeconds: 60 * 60 * 24 * 365 }, // 365 days
];

/**
 * Buckets an address's tenure by checking whether its nonce was already
 * nonzero at a handful of historical checkpoints (all fetched in one
 * parallel batch), oldest-tier-that-still-shows-activity wins. Never
 * throws: any RPC error (most commonly a non-archive node rejecting a
 * historical query) is caught and degrades to `null` — see
 * OnChainSignal.walletAgeTier's doc comment. Caller has already confirmed
 * `transactionCount > 0` before calling this.
 */
async function classifyWalletAgeFromCheckpoints(
  client: PublicClient,
  address: `0x${string}`,
  currentBlock: bigint
): Promise<WalletAgeTier | null> {
  try {
    const checks = await Promise.all(
      AGE_CHECKPOINTS.map(async ({ tier, ageSeconds }) => {
        const blocksAgo = BigInt(Math.round(ageSeconds * BLOCKS_PER_SECOND));
        const blockNumber = blocksAgo >= currentBlock ? 0n : currentBlock - blocksAgo;
        const txCountThen = await client.getTransactionCount({ address, blockNumber });
        return { tier, activeByThen: txCountThen > 0 };
      })
    );

    // AGE_CHECKPOINTS is ordered newest-tier-first; the OLDEST checkpoint
    // that still shows prior activity is the address's real tier — e.g. if
    // it was already active 30 days ago, it's at least "established", even
    // though it's technically also "new"/"young" by the nearer checkpoints.
    let best: WalletAgeTier = "brand_new";
    for (const { tier, activeByThen } of checks) {
      if (activeByThen) best = tier;
    }
    return best;
  } catch {
    return null;
  }
}

/**
 * Pure protocol-level facts about an address, sourced directly from the
 * chain via standard JSON-RPC calls (eth_getCode, eth_getTransactionCount,
 * eth_getBalance, eth_blockNumber) — no third-party API, no indexer, works
 * against any RPC endpoint for any EVM chain (wallet-age tiering degrades
 * to `null` rather than failing on an RPC that can't serve historical
 * state). This is the risk signal VAPOR can always compute, even with no
 * reputation-intelligence provider configured.
 */
export async function fetchOnChainSignal(
  client: PublicClient,
  address: `0x${string}`
): Promise<OnChainSignal> {
  const [bytecode, transactionCount, nativeBalanceWei, currentBlock] = await Promise.all([
    client.getCode({ address }),
    client.getTransactionCount({ address }),
    client.getBalance({ address }),
    client.getBlockNumber(),
  ]);

  // Only worth the extra round-trip when there's actually a nonce history
  // to date — see walletAgeTier's doc comment for why transactionCount 0
  // can never be aged.
  const walletAgeTier =
    transactionCount > 0 ? await classifyWalletAgeFromCheckpoints(client, address, currentBlock) : null;

  return {
    isContract: !!bytecode && bytecode !== "0x",
    transactionCount,
    nativeBalanceWei,
    walletAgeTier,
  };
}
