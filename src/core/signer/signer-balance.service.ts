import { formatEther } from "viem";
import { Gauge } from "prom-client";
import { getPublicClient, getWalletClient } from "../../blockchain/clients/chain.client.js";
import { activeNetworks } from "../../config/networks.js";
import { config } from "../../config/index.js";
import { logger } from "../../utils/logger.js";
import { registry } from "../metrics/metrics.service.js";

/**
 * The settlement signer never custodies user funds — transferWithAuthorization
 * moves USDC directly from payer to payee per the payer's own EIP-3009
 * signature, so a compromised or drained signer key can't redirect that
 * value. What it CAN do is pay gas to broadcast settlements, so the one real
 * operational risk of an unwatched key is running out of native currency
 * silently: settlement then starts failing (indistinguishable from a chain
 * problem) with no advance warning. This gauge plus the periodic sweep below
 * exists to make that failure mode visible before it happens, not to guard
 * against theft (there's nothing to steal from this wallet but its own gas).
 */
export const signerBalanceGauge = new Gauge({
  name: "vapor_signer_native_balance_wei",
  help: "Settlement signer's native-currency balance (wei), by network — pays gas only, never holds payer funds",
  labelNames: ["network"] as const,
  registers: [registry],
});

/** Checks every active network's signer balance, updates the metric, and
 * logs a warning once it drops below config.signerLowBalanceEth — cheap
 * enough (one eth_getBalance per network) to run on a slow interval
 * indefinitely alongside request serving. A failure on one network (RPC
 * hiccup) must never block the others. */
export async function sweepSignerBalances(): Promise<void> {
  for (const network of activeNetworks()) {
    const walletClient = getWalletClient(network);
    if (!walletClient?.account) continue;

    try {
      const publicClient = getPublicClient(network);
      const balance = await publicClient.getBalance({ address: walletClient.account.address });
      signerBalanceGauge.set({ network: network.caip2 }, Number(balance));

      const balanceEth = Number(formatEther(balance));
      if (balanceEth < config.signerLowBalanceEth) {
        logger.warn(
          { network: network.caip2, address: walletClient.account.address, balanceEth },
          "settlement signer's native balance is low — settlement will start failing once gas can no longer be paid"
        );
      }
    } catch (err) {
      logger.error({ err, network: network.caip2 }, "signer balance check failed");
    }
  }
}
