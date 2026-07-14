import type { NetworkConfig } from "../../config/networks.js";
import { getPublicClient } from "../../blockchain/clients/chain.client.js";
import { fetchOnChainSignal } from "../risk/providers/onchain-heuristics.provider.js";
import { checkReputation } from "../risk/providers/reputation-intel.provider.js";
import { computePayeeReputation, type PayeeHistory } from "../../utils/payee-reputation-score.js";
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

/**
 * Scores a payee/service address — the mirror of scanAddress() (the payer
 * risk scanner), letting a payer pre-check who they're about to pay rather
 * than only payees pre-checking who's paying them.
 */
export async function scorePayee(network: NetworkConfig, payTo: `0x${string}`): Promise<PayeeReputation> {
  const client = getPublicClient(network);

  const [onChain, reputation, history] = await Promise.all([
    fetchOnChainSignal(client, payTo),
    checkReputation(payTo, network.chain.id).catch((err) => {
      logger.warn({ err, payTo }, "reputation check threw unexpectedly, continuing without it");
      return null;
    }),
    getPayeeHistory(payTo),
  ]);

  return computePayeeReputation(payTo, onChain, reputation, history);
}
