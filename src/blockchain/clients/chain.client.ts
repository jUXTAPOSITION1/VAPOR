import { createPublicClient, createWalletClient, http, type PublicClient, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { NetworkConfig } from "../../config/networks.js";
import { config } from "../../config/index.js";
import { logger } from "../../utils/logger.js";

const publicClients = new Map<string, PublicClient>();

/** One public (read-only) client per network, created lazily and cached —
 * every read (balance checks, on-chain heuristics) shares a single client
 * per network rather than opening a new HTTP connection per request. */
export function getPublicClient(network: NetworkConfig): PublicClient {
  const cached = publicClients.get(network.caip2);
  if (cached) return cached;

  const rpcUrl = process.env[network.rpcEnvVar];
  if (!rpcUrl) {
    throw new Error(`No RPC URL configured for ${network.caip2} (expected env var ${network.rpcEnvVar})`);
  }

  const client = createPublicClient({
    chain: network.chain,
    transport: http(rpcUrl),
  }) as PublicClient;
  publicClients.set(network.caip2, client);
  return client;
}

/** The wallet client that actually broadcasts settlement transactions.
 * Undefined (not thrown) when no signer key is configured — callers decide
 * whether that's fatal (settlement) or fine (verification never needs it).
 *
 * Config validation already rejects a malformed key at boot (see
 * config/index.ts), but this still wraps privateKeyToAccount defensively:
 * an uncaught throw here would crash the entire Node process on the next
 * /settle call, taking down every endpoint (not just settlement) until
 * someone manually restarts it — a single bad key must never be able to
 * do that, regardless of how it got past the earlier check. */
export function getWalletClient(network: NetworkConfig): WalletClient | undefined {
  if (!config.settlementSignerPrivateKey) return undefined;
  const rpcUrl = process.env[network.rpcEnvVar];
  if (!rpcUrl) return undefined;

  let account;
  try {
    account = privateKeyToAccount(config.settlementSignerPrivateKey);
  } catch (err) {
    logger.error({ err }, "SETTLEMENT_SIGNER_PRIVATE_KEY is invalid — settlement is disabled until it's fixed");
    return undefined;
  }

  return createWalletClient({
    account,
    chain: network.chain,
    transport: http(rpcUrl),
  });
}
