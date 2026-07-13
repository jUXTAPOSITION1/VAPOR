import { base } from "viem/chains";
import type { Chain } from "viem";

/**
 * Every network VAPOR can settle on needs three verified facts: a chain
 * definition, an RPC URL, and the exact stablecoin contract it settles in
 * (EIP-3009's transferWithAuthorization only exists on the token contract,
 * not the network — the wrong address here doesn't fail loudly, it just
 * quietly points signature verification at the wrong domain).
 *
 * Base mainnet's USDC address below is verified against this project's own
 * prior on-chain work, not typed from memory. Do not add another network
 * by copying an address from documentation alone — confirm it against the
 * chain (or a source you've independently checked) first.
 */
export interface NetworkConfig {
  caip2: string;
  chain: Chain;
  rpcEnvVar: string;
  usdc: {
    address: `0x${string}`;
    name: string;
    version: string;
    decimals: number;
  };
}

export const NETWORKS: Record<string, NetworkConfig> = {
  "eip155:8453": {
    caip2: "eip155:8453",
    chain: base,
    rpcEnvVar: "BASE_MAINNET_RPC_URL",
    usdc: {
      address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      name: "USD Coin",
      version: "2",
      decimals: 6,
    },
  },
};

export function resolveNetwork(caip2: string): NetworkConfig | undefined {
  return NETWORKS[caip2];
}

/** Networks with both an RPC URL configured and a verified token contract —
 * the only ones VAPOR will actually advertise or accept payments for. */
export function activeNetworks(): NetworkConfig[] {
  return Object.values(NETWORKS).filter((n) => !!process.env[n.rpcEnvVar]);
}
