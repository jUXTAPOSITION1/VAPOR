import { getWalletClient, getPublicClient } from "../../blockchain/clients/chain.client.js";
import { EIP3009_ABI } from "../../blockchain/abi.js";
import { resolveNetwork, type NetworkConfig } from "../../config/networks.js";
import type { PaymentPayload, PaymentRequirements, SettleResponse } from "../../types/x402.js";
import { verifyPayment } from "../verification/verification.service.js";
import { logger } from "../../utils/logger.js";
import type { PublicClient, WalletClient } from "viem";

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
 * A payee opts into async settlement per-request via
 * `paymentRequirements.extra.async === true` — default behavior (the base
 * x402 contract) is unchanged: /settle only reports `success: true` once
 * settlement is actually confirmed on-chain. This is deliberately NOT the
 * default, since a resource server that doesn't understand the `pending`
 * extension would otherwise have no way to know a `success: false` response
 * might still turn into a success later.
 */
export function isAsyncSettlementRequested(extra: Record<string, unknown> | undefined): boolean {
  return extra?.["async"] === true;
}

type PreparedSettlement =
  | { ok: false; response: SettleResponse }
  | {
      ok: true;
      network: NetworkConfig;
      walletClient: WalletClient & { account: NonNullable<WalletClient["account"]> };
      publicClient: PublicClient;
      payer: `0x${string}` | undefined;
      authorization: PaymentPayload["payload"]["authorization"];
      split: { r: `0x${string}`; s: `0x${string}`; v: number };
    };

/**
 * Everything settlement needs to do BEFORE broadcasting: re-verify against
 * live chain state (state can change between a caller's /verify and
 * /settle calls, and settlement is the point of no return), resolve the
 * signer, and split the signature. Shared by both the synchronous and
 * async settlement paths so they can never drift from each other on what
 * counts as a "can't even attempt this" failure.
 */
async function prepareSettlement(
  paymentPayload: PaymentPayload,
  paymentRequirements: PaymentRequirements
): Promise<PreparedSettlement> {
  const network = resolveNetwork(paymentPayload.network);
  if (!network) {
    return {
      ok: false,
      response: {
        success: false,
        errorReason: `unsupported network: ${paymentPayload.network}`,
        transaction: "",
        network: paymentPayload.network,
      },
    };
  }

  const verification = await verifyPayment(paymentPayload, paymentRequirements);
  if (!verification.isValid) {
    return {
      ok: false,
      response: {
        success: false,
        errorReason: verification.invalidReason ?? "payment failed verification",
        payer: verification.payer,
        transaction: "",
        network: paymentPayload.network,
      },
    };
  }

  const walletClient = getWalletClient(network);
  if (!walletClient || !walletClient.account) {
    return {
      ok: false,
      response: {
        success: false,
        errorReason: "no settlement signer configured on this facilitator",
        payer: verification.payer,
        transaction: "",
        network: paymentPayload.network,
      },
    };
  }

  const { authorization, signature } = paymentPayload.payload;
  let split: { r: `0x${string}`; s: `0x${string}`; v: number };
  try {
    split = splitSignature(signature);
  } catch (err) {
    logger.warn({ err }, "malformed signature at settlement time");
    return {
      ok: false,
      response: {
        success: false,
        errorReason: "malformed signature",
        payer: verification.payer,
        transaction: "",
        network: paymentPayload.network,
      },
    };
  }

  return {
    ok: true,
    network,
    walletClient: walletClient as WalletClient & { account: NonNullable<WalletClient["account"]> },
    publicClient: getPublicClient(network),
    payer: verification.payer,
    authorization,
    split,
  };
}

/** Waits for the broadcast transaction's receipt and classifies the final
 * outcome. Shared by the sync path (awaited inline) and the async path
 * (awaited in the background after the response has already gone out). */
async function finalizeSettlement(
  publicClient: PublicClient,
  hash: `0x${string}`,
  payer: `0x${string}` | undefined,
  network: string,
  amount: string
): Promise<SettleResponse> {
  try {
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      return {
        success: false,
        errorReason: "settlement transaction reverted on-chain",
        payer,
        transaction: hash,
        network,
      };
    }
    return { success: true, payer, transaction: hash, network, amount };
  } catch (err) {
    logger.error({ err }, "settlement transaction failed to confirm");
    return {
      success: false,
      errorReason: "settlement transaction failed to confirm",
      payer,
      transaction: hash,
      network,
    };
  }
}

/**
 * Settles a payment on-chain via transferWithAuthorization. Re-runs the
 * full verification pipeline immediately beforehand rather than trusting a
 * caller's earlier /verify response — state (balance, nonce usage, risk)
 * can change between the two calls, and settlement is the point of no
 * return, so it re-checks against current chain state right before
 * broadcasting.
 *
 * Blocks until the transaction is confirmed (or fails) — the base x402
 * contract's `success` field is only ever true once settlement is final.
 * See settlePaymentAsync for the opt-in alternative that doesn't block on
 * confirmation.
 */
export async function settlePayment(
  paymentPayload: PaymentPayload,
  paymentRequirements: PaymentRequirements
): Promise<SettleResponse> {
  const prepared = await prepareSettlement(paymentPayload, paymentRequirements);
  if (!prepared.ok) return prepared.response;

  const { walletClient, publicClient, payer, authorization, split } = prepared;

  let hash: `0x${string}`;
  try {
    hash = await walletClient.writeContract({
      address: prepared.network.usdc.address,
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
      chain: prepared.network.chain,
      account: walletClient.account,
    });
  } catch (err) {
    logger.error({ err }, "settlement transaction failed to broadcast");
    return { success: false, errorReason: "settlement transaction failed", payer, transaction: "", network: paymentPayload.network };
  }

  return finalizeSettlement(publicClient, hash, payer, paymentPayload.network, authorization.value);
}

/**
 * Opt-in alternative to settlePayment for callers that set
 * `paymentRequirements.extra.async === true` — broadcasts the same
 * transferWithAuthorization but returns immediately after the transaction
 * is sent, without waiting for on-chain confirmation. The immediate
 * response has `success: false, pending: true` (never `success: true` —
 * that would misrepresent an unconfirmed transaction as a final one to any
 * caller that doesn't understand the `pending` extension) plus the
 * broadcast `transaction` hash. Confirmation happens in the background;
 * the caller learns the real outcome via its configured webhookUrl
 * (`payment.settled` / `payment.settlement_failed`, same as the sync path)
 * or by independently watching the transaction hash on-chain.
 *
 * Any failure that happens BEFORE broadcast (invalid payment, no signer,
 * malformed signature, broadcast itself rejected) is still a genuine,
 * immediate, final failure — there's nothing pending about a transaction
 * that was never sent.
 */
export async function settlePaymentAsync(
  paymentPayload: PaymentPayload,
  paymentRequirements: PaymentRequirements,
  onResolved: (result: SettleResponse) => void
): Promise<SettleResponse> {
  const prepared = await prepareSettlement(paymentPayload, paymentRequirements);
  if (!prepared.ok) return prepared.response;

  const { walletClient, publicClient, payer, authorization, split } = prepared;

  let hash: `0x${string}`;
  try {
    hash = await walletClient.writeContract({
      address: prepared.network.usdc.address,
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
      chain: prepared.network.chain,
      account: walletClient.account,
    });
  } catch (err) {
    logger.error({ err }, "settlement transaction failed to broadcast");
    return { success: false, errorReason: "settlement transaction failed", payer, transaction: "", network: paymentPayload.network };
  }

  finalizeSettlement(publicClient, hash, payer, paymentPayload.network, authorization.value)
    .then(onResolved)
    .catch((err) => {
      logger.error({ err, hash }, "async settlement finalization threw unexpectedly");
    });

  return { success: false, pending: true, payer, transaction: hash, network: paymentPayload.network, amount: authorization.value };
}
