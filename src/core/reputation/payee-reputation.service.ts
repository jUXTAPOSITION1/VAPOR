import type { NetworkConfig } from "../../config/networks.js";
import { getPublicClient } from "../../blockchain/clients/chain.client.js";
import { fetchOnChainSignal } from "../risk/providers/onchain-heuristics.provider.js";
import { checkReputation } from "../risk/providers/reputation-intel.provider.js";
import { getAgentWallet, getReputationSummary } from "../../blockchain/clients/erc8004.client.js";
import { computePayeeReputation, type Erc8004Check, type PayeeHistory } from "../../utils/payee-reputation-score.js";
import { prisma } from "../../storage/prisma.client.js";
import type { PayeeReputation } from "../../types/x402.js";
import { logger } from "../../utils/logger.js";

/** Real settlement history for a payTo address, straight from VAPOR's own
 * audit log — never fabricated, and empty/zeroed for any address VAPOR
 * hasn't actually processed a payment for yet. */
async function getPayeeHistory(payTo: string): Promise<PayeeHistory> {
  const [totalVerifyRequests, totalSettlements, settledAmounts, earliest] = await Promise.all([
    prisma.paymentRecord.count({ where: { payTo, stage: "verify", isValid: true } }),
    prisma.paymentRecord.count({ where: { payTo, stage: "settle", settled: true } }),
    prisma.paymentRecord.findMany({
      where: { payTo, stage: "settle", settled: true },
      select: { amount: true },
    }),
    prisma.paymentRecord.findFirst({
      where: { payTo },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
  ]);

  let settledVolumeRaw = 0n;
  for (const { amount } of settledAmounts) {
    try {
      settledVolumeRaw += BigInt(amount);
    } catch {
      // malformed stored amount — skip rather than throw off the whole history
    }
  }

  return {
    totalVerifyRequests,
    totalSettlements,
    settlementSuccessRate: totalVerifyRequests > 0 ? totalSettlements / totalVerifyRequests : null,
    // USDC is the only supported asset today, always 6 decimals.
    totalSettledVolumeUsd: Number(settledVolumeRaw) / 1_000_000,
    firstSeenAt: earliest?.createdAt.toISOString() ?? null,
  };
}

/** Opt-in ERC-8004 lookup: only runs when the caller supplies an agentId,
 * and only counts as "verified" if that agentId's on-chain claimed wallet
 * actually matches payTo — VAPOR never trusts a caller-asserted identity
 * without checking it against the registry itself. Any RPC failure here
 * degrades to "no ERC-8004 data" rather than failing the whole request,
 * since this is an enrichment, not a required check. */
async function checkErc8004(
  network: NetworkConfig,
  payTo: `0x${string}`,
  agentId: bigint
): Promise<Erc8004Check | undefined> {
  const client = getPublicClient(network);
  try {
    const claimedWallet = await getAgentWallet(client, agentId);
    const verified = claimedWallet.toLowerCase() === payTo.toLowerCase();
    if (!verified) {
      return { agentId: agentId.toString(), verified: false, feedbackCount: 0, averageScore: null };
    }
    const summary = await getReputationSummary(client, agentId);
    return { agentId: agentId.toString(), verified: true, ...summary };
  } catch (err) {
    logger.warn({ err, payTo, agentId: agentId.toString() }, "ERC-8004 lookup failed, continuing without it");
    return undefined;
  }
}

/**
 * Scores a payee/service address — the mirror of scanAddress() (the payer
 * risk scanner), letting a payer pre-check who they're about to pay rather
 * than only payees pre-checking who's paying them.
 */
export async function scorePayee(
  network: NetworkConfig,
  payTo: `0x${string}`,
  claimedAgentId?: bigint
): Promise<PayeeReputation> {
  const client = getPublicClient(network);

  const [onChain, reputation, history, erc8004] = await Promise.all([
    fetchOnChainSignal(client, payTo),
    checkReputation(payTo, network.chain.id).catch((err) => {
      logger.warn({ err, payTo }, "reputation check threw unexpectedly, continuing without it");
      return null;
    }),
    getPayeeHistory(payTo),
    claimedAgentId !== undefined ? checkErc8004(network, payTo, claimedAgentId) : Promise.resolve(undefined),
  ]);

  return computePayeeReputation(payTo, onChain, reputation, history, erc8004);
}
