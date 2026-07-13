import { createPublicClient, createWalletClient, http, type PublicClient, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { NetworkConfig } from "../../config/networks.js";
import { config } from "../../config/index.js";

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
 * whether that's fatal (settlement) or fine (verification never needs it). */
export function getWalletClient(network: NetworkConfig): WalletClient | undefined {
  if (!config.settlementSignerPrivateKey) return undefined;
  const rpcUrl = process.env[network.rpcEnvVar];
  if (!rpcUrl) return undefined;

  const account = privateKeyToAccount(config.settlementSignerPrivateKey);
  return createWalletClient({
    account,
    chain: network.chain,
    transport: http(rpcUrl),
  });
}
