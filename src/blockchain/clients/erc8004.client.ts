import type { PublicClient } from "viem";

/**
 * ERC-8004 (Trustless Agents) Identity + Reputation registries. Deployed at
 * the same address across 40+ EVM chains including Base mainnet — verified
 * independently against Etherscan, BscScan, and BaseScan (all three list
 * these as "8004: Identity Registry" / "8004: Reputation Registry") before
 * being hardcoded here, not copied from a single unverified source.
 * https://github.com/erc-8004/erc-8004-contracts
 */
export const ERC8004_IDENTITY_REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as const;
export const ERC8004_REPUTATION_REGISTRY = "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63" as const;

const IDENTITY_REGISTRY_ABI = [
  {
    type: "function",
    name: "getAgentWallet",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

const REPUTATION_REGISTRY_ABI = [
  {
    type: "function",
    name: "getSummary",
    stateMutability: "view",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "clientAddresses", type: "address[]" },
      { name: "tag1", type: "string" },
      { name: "tag2", type: "string" },
    ],
    outputs: [
      { name: "count", type: "uint64" },
      { name: "summaryValue", type: "int128" },
      { name: "summaryValueDecimals", type: "uint8" },
    ],
  },
] as const;

export interface Erc8004ReputationSummary {
  feedbackCount: number;
  averageScore: number | null;
}

/** Resolves the wallet an agentId currently claims — VAPOR uses this to
 * verify a payee-supplied agentId actually belongs to the address being
 * scored, before trusting anything read from the registry. Opt-in only:
 * VAPOR never guesses or reverse-looks-up an agentId on its own (no such
 * lookup exists on-chain), so an address with no claimed agentId simply
 * gets no ERC-8004 enrichment. */
export async function getAgentWallet(client: PublicClient, agentId: bigint): Promise<`0x${string}`> {
  return client.readContract({
    address: ERC8004_IDENTITY_REGISTRY,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: "getAgentWallet",
    args: [agentId],
  });
}

/** Aggregate reputation feedback for an agentId across all clients —
 * real on-chain data other x402 payers/facilitators may have already
 * attested, independent of VAPOR's own settlement history. */
export async function getReputationSummary(
  client: PublicClient,
  agentId: bigint
): Promise<Erc8004ReputationSummary> {
  const [count, summaryValue, summaryValueDecimals] = await client.readContract({
    address: ERC8004_REPUTATION_REGISTRY,
    abi: REPUTATION_REGISTRY_ABI,
    functionName: "getSummary",
    args: [agentId, [], "", ""],
  });

  return {
    // summaryValue is already the mean across matching feedback (the
    // registry computes sum/count internally in WAD precision before
    // scaling back down) — dividing by count again here would be wrong.
    feedbackCount: Number(count),
    averageScore: count > 0n ? Number(summaryValue) / 10 ** summaryValueDecimals : null,
  };
}
