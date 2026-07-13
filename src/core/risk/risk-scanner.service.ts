import type { NetworkConfig } from "../../config/networks.js";
import { getPublicClient } from "../../blockchain/clients/chain.client.js";
import { fetchOnChainSignal } from "./providers/onchain-heuristics.provider.js";
import { checkReputation } from "./providers/reputation-intel.provider.js";
import { computeRiskScore } from "../../utils/risk-score.js";
import type { RiskAssessment } from "../../types/x402.js";
import { logger } from "../../utils/logger.js";

/**
 * VAPOR's core differentiator: scan a payer address BEFORE settlement
 * decisions are made, combining a real-time on-chain read (always
 * available) with an optional external reputation signal (additive,
 * degrades gracefully when unconfigured — see reputation-intel.provider.ts).
 */
export async function scanAddress(network: NetworkConfig, address: `0x${string}`): Promise<RiskAssessment> {
  const client = getPublicClient(network);

  const [onChain, reputation] = await Promise.all([
    fetchOnChainSignal(client, address),
    checkReputation(address, network.chain.id).catch((err) => {
      logger.warn({ err, address }, "reputation check threw unexpectedly, continuing without it");
      return null;
    }),
  ]);

  return computeRiskScore(onChain, reputation);
}
