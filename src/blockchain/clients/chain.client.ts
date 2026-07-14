import { createPublicClient, createWalletClient, http, fallback, type PublicClient, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { NetworkConfig } from "../../config/networks.js";
import { config } from "../../config/index.js";
import { logger } from "../../utils/logger.js";

const publicClients = new Map<string, PublicClient>();

/** A network's RPC env var may hold one URL or several, comma-separated —
 * the first is primary, the rest are failover-only. Whitespace around each
 * is trimmed and empty entries dropped so a trailing comma or stray space
 * doesn't produce a blank "URL". */
export function resolveRpcUrls(network: NetworkConfig): string[] {
  const raw = process.env[network.rpcEnvVar];
  if (!raw) return [];
  return raw
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
}

/** A single URL gets a plain http() transport (no point wrapping one entry
 * in a fallback). Two or more get viem's fallback transport with ranking
 * OFF — `rank: false` (the default) means strict priority order: try the
 * first URL, and only move to the next on failure, rather than
 * continuously re-ranking by latency and non-deterministically shifting
 * which endpoint serves requests. */
export function buildTransport(rpcUrls: string[]) {
  if (rpcUrls.length === 1) return http(rpcUrls[0]);
  return fallback(rpcUrls.map((url) => http(url)));
}

/** One public (read-only) client per network, created lazily and cached —
 * every read (balance checks, on-chain heuristics) shares a single client
 * per network rather than opening a new HTTP connection per request. */
export function getPublicClient(network: NetworkConfig): PublicClient {
  const cached = publicClients.get(network.caip2);
  if (cached) return cached;

  const rpcUrls = resolveRpcUrls(network);
  if (rpcUrls.length === 0) {
    throw new Error(`No RPC URL configured for ${network.caip2} (expected env var ${network.rpcEnvVar})`);
  }

  const client = createPublicClient({
    chain: network.chain,
    transport: buildTransport(rpcUrls),
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
  const rpcUrls = resolveRpcUrls(network);
  if (rpcUrls.length === 0) return undefined;

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
    transport: buildTransport(rpcUrls),
  });
}
