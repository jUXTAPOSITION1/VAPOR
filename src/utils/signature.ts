import { recoverTypedDataAddress } from "viem";
import type { NetworkConfig } from "../config/networks.js";
import type { ExactEvmAuthorization } from "../types/x402.js";

const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

/**
 * Recovers the address that actually signed the EIP-3009 authorization.
 *
 * Deliberately builds the EIP-712 domain from VAPOR's OWN verified network
 * config (`network.usdc.name`/`.version`, `network.chain.id`,
 * `network.usdc.address`) — never from caller-supplied domain parameters.
 * A facilitator that let a caller specify its own domain/verifyingContract
 * would let an attacker construct a signature that "verifies" against
 * whatever contract they chose, not the real token — the recovered address
 * would be real, but the guarantee that it authorized a transfer of a real,
 * spendable balance would not be.
 */
export async function recoverAuthorizationSigner(
  network: NetworkConfig,
  authorization: ExactEvmAuthorization,
  signature: `0x${string}`
): Promise<`0x${string}`> {
  return recoverTypedDataAddress({
    domain: {
      name: network.usdc.name,
      version: network.usdc.version,
      chainId: network.chain.id,
      verifyingContract: network.usdc.address,
    },
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: "TransferWithAuthorization",
    message: {
      from: authorization.from,
      to: authorization.to,
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce: authorization.nonce,
    },
    signature,
  });
}
