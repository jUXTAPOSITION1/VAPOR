import { getWalletClient, getPublicClient } from "../../blockchain/clients/chain.client.js";
import { EIP3009_ABI } from "../../blockchain/abi.js";
import { resolveNetwork } from "../../config/networks.js";
import type { PaymentPayload, PaymentRequirements, SettleResponse } from "../../types/x402.js";
import { verifyPayment } from "../verification/verification.service.js";
import { logger } from "../../utils/logger.js";

/**
 * Splits a 65-byte ECDSA signature into the (v, r, s) triple
 * transferWithAuthorization expects. Handles both the canonical 27/28 `v`
 * and the 0/1 recovery-id form some signers emit.
 */
export function splitSignature(signature: `0x${string}`): { r: `0x${string}`; s: `0x${string}`; v: number } {
  const hex = signature.slice(2);
  if (hex.length !== 130) {
    throw new Error("signature must be exactly 65 bytes (130 hex characters)");
  }
  const r = `0x${hex.slice(0, 64)}` as `0x${string}`;
  const s = `0x${hex.slice(64, 128)}` as `0x${string}`;
  let v = parseInt(hex.slice(128, 130), 16);
  if (v < 27) v += 27;
  return { r, s, v };
}

/**
 * Settles a payment on-chain via transferWithAuthorization. Re-runs the
 * full verification pipeline immediately beforehand rather than trusting a
 * caller's earlier /verify response — state (balance, nonce usage, risk)
 * can change between the two calls, and settlement is the point of no
 * return, so it re-checks against current chain state right before
 * broadcasting.
 */
export async function settlePayment(
  paymentPayload: PaymentPayload,
  paymentRequirements: PaymentRequirements
): Promise<SettleResponse> {
  const network = resolveNetwork(paymentPayload.network);
  if (!network) {
    return {
      success: false,
      errorReason: `unsupported network: ${paymentPayload.network}`,
      transaction: "",
      network: paymentPayload.network,
    };
  }

  const verification = await verifyPayment(paymentPayload, paymentRequirements);
  if (!verification.isValid) {
    return {
      success: false,
      errorReason: verification.invalidReason ?? "payment failed verification",
      payer: verification.payer,
      transaction: "",
      network: paymentPayload.network,
    };
  }

  const walletClient = getWalletClient(network);
  if (!walletClient || !walletClient.account) {
    return {
      success: false,
      errorReason: "no settlement signer configured on this facilitator",
      payer: verification.payer,
      transaction: "",
      network: paymentPayload.network,
    };
  }

  const { authorization, signature } = paymentPayload.payload;
  let split: { r: `0x${string}`; s: `0x${string}`; v: number };
  try {
    split = splitSignature(signature);
  } catch (err) {
    logger.warn({ err }, "malformed signature at settlement time");
    return {
      success: false,
      errorReason: "malformed signature",
      payer: verification.payer,
      transaction: "",
      network: paymentPayload.network,
    };
  }

  const publicClient = getPublicClient(network);

  try {
    const hash = await walletClient.writeContract({
      address: network.usdc.address,
      abi: EIP3009_ABI,
      functionName: "transferWithAuthorization",
      args: [
        authorization.from,
        authorization.to,
        BigInt(authorization.value),
        BigInt(authorization.validAfter),
        BigInt(authorization.validBefore),
        authorization.nonce,
        split.v,
        split.r,
        split.s,
      ],
      chain: network.chain,
      account: walletClient.account,
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      return {
        success: false,
        errorReason: "settlement transaction reverted on-chain",
        payer: verification.payer,
        transaction: hash,
        network: paymentPayload.network,
      };
    }

    return {
      success: true,
      payer: verification.payer,
      transaction: hash,
      network: paymentPayload.network,
      amount: authorization.value,
    };
  } catch (err) {
    logger.error({ err }, "settlement transaction failed to broadcast or confirm");
    return {
      success: false,
      errorReason: "settlement transaction failed",
      payer: verification.payer,
      transaction: "",
      network: paymentPayload.network,
    };
  }
}
