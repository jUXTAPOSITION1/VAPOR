import { getAddress, isAddressEqual } from "viem";
import type { PaymentPayload, PaymentRequirements, VerifyResponse } from "../../types/x402.js";
import { resolveNetwork } from "../../config/networks.js";
import { recoverAuthorizationSigner } from "../../utils/signature.js";
import { getPublicClient } from "../../blockchain/clients/chain.client.js";
import { EIP3009_ABI } from "../../blockchain/abi.js";
import { scanAddress } from "../risk/risk-scanner.service.js";
import { evaluatePolicy } from "../policy/policy.engine.js";
import { logger } from "../../utils/logger.js";

/**
 * Full "exact" scheme verification, in the order that fails cheapest-first
 * (no signature math or RPC calls wasted on a request that's malformed on
 * its face):
 *
 * 1. Network/asset match VAPOR's own verified config — never the
 *    request's own domain claims (see utils/signature.ts's docstring).
 * 2. Time window (validAfter/validBefore) — pure arithmetic.
 * 3. Amount match — pure arithmetic.
 * 4. Parameter match (authorization.to === paymentRequirements.payTo).
 * 5. Signature recovery — recovered signer must equal authorization.from.
 * 6. On-chain: authorization not already used (authorizationState), and
 *    the payer's real balance covers the value.
 * 7. Risk scan + policy evaluation — VAPOR's own addition, never part of
 *    the base x402 spec. A risk-scan failure still returns isValid: true
 *    for the payment itself (the signature and funds are genuinely good)
 *    but reports the assessment so the payee's own policy can refuse to
 *    proceed — VAPOR informs, it doesn't unilaterally decide for the payee
 *    beyond what that payee's own configured policy asks it to.
 */
export async function verifyPayment(
  paymentPayload: PaymentPayload,
  paymentRequirements: PaymentRequirements
): Promise<VerifyResponse> {
  if (paymentPayload.scheme !== "exact" || paymentRequirements.scheme !== "exact") {
    return { isValid: false, invalidReason: "unsupported scheme" };
  }
  if (paymentPayload.network !== paymentRequirements.network) {
    return { isValid: false, invalidReason: "network mismatch between payload and requirements" };
  }

  const network = resolveNetwork(paymentPayload.network);
  if (!network) {
    return { isValid: false, invalidReason: `unsupported network: ${paymentPayload.network}` };
  }

  let requiredAsset: `0x${string}`;
  try {
    requiredAsset = getAddress(paymentRequirements.asset);
  } catch {
    return { isValid: false, invalidReason: "malformed asset address in payment requirements" };
  }
  if (!isAddressEqual(requiredAsset, network.usdc.address)) {
    return { isValid: false, invalidReason: "unsupported asset for this network" };
  }

  const { authorization, signature } = paymentPayload.payload;

  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  const validAfter = BigInt(authorization.validAfter);
  const validBefore = BigInt(authorization.validBefore);
  if (nowSeconds < validAfter || nowSeconds >= validBefore) {
    return { isValid: false, invalidReason: "authorization outside its valid time window" };
  }

  const required = BigInt(paymentRequirements.maxAmountRequired);
  const value = BigInt(authorization.value);
  if (value !== required) {
    return { isValid: false, invalidReason: "authorization value does not match required amount" };
  }

  let payTo: `0x${string}`;
  let from: `0x${string}`;
  try {
    payTo = getAddress(paymentRequirements.payTo);
    from = getAddress(authorization.from);
  } catch {
    return { isValid: false, invalidReason: "malformed address in authorization or requirements" };
  }
  if (!isAddressEqual(getAddress(authorization.to), payTo)) {
    return { isValid: false, invalidReason: "authorization recipient does not match payTo" };
  }

  let recovered: `0x${string}`;
  try {
    recovered = await recoverAuthorizationSigner(network, authorization, signature);
  } catch (err) {
    logger.warn({ err }, "signature recovery failed");
    return { isValid: false, invalidReason: "invalid signature" };
  }
  if (!isAddressEqual(recovered, from)) {
    return { isValid: false, invalidReason: "signature was not signed by the claimed payer" };
  }

  // Both the getPublicClient() call and the reads below throw on any RPC
  // trouble (no URL configured, timeout, rate limit, a non-archive node
  // rejecting a call, etc.) — none of that is caught anywhere above this
  // function. Left unguarded, that throw propagates out of verifyPayment(),
  // past the route handler (Express 5 auto-forwards a rejected async
  // handler to errorMiddleware), and becomes an unrecorded 500: the
  // resource server sees a bare infra failure indistinguishable from "this
  // facilitator is down" and the attempt never reaches
  // recordVerification/verifyOutcomesTotal, so it's invisible in this
  // facilitator's own /stats too — a transient RPC hiccup silently erased
  // every trace of a real payment attempt instead of failing informatively.
  // A clean, recorded "temporarily can't verify" response is the correct
  // degrade here: this step establishes ground truth (replay/balance) that
  // nothing below can safely substitute for, so it's a real invalid
  // result, just not a security invalid one.
  let alreadyUsed: unknown;
  let balance: bigint;
  try {
    const client = getPublicClient(network);
    [alreadyUsed, balance] = await Promise.all([
      client.readContract({
        address: network.usdc.address,
        abi: EIP3009_ABI,
        functionName: "authorizationState",
        args: [from, authorization.nonce],
      }),
      client.readContract({
        address: network.usdc.address,
        abi: EIP3009_ABI,
        functionName: "balanceOf",
        args: [from],
      }),
    ]);
  } catch (err) {
    logger.error({ err, network: network.caip2 }, "on-chain state read failed during verification");
    return { isValid: false, invalidReason: "temporarily unable to verify on-chain state (RPC error)" };
  }

  if (alreadyUsed) {
    return { isValid: false, invalidReason: "authorization nonce has already been used" };
  }
  if (balance < value) {
    return { isValid: false, invalidReason: "payer balance is insufficient" };
  }

  // Signature and funds are already confirmed genuinely good at this
  // point — per this function's own docstring, a risk-scan failure must
  // never turn a valid payment invalid (VAPOR informs, it doesn't
  // unilaterally decide). Before this fix that intent was only honored for
  // a risk assessment that came back negative; an infra failure while
  // producing the assessment at all (the same class of RPC trouble as
  // above, since scanAddress's on-chain signal shares this network's
  // client) still threw straight through with no such grace. Degrading to
  // "valid, no risk data" here is what actually delivers on the stated
  // contract.
  try {
    const riskAssessment = await scanAddress(network, from);
    const policyDecision = evaluatePolicy(paymentRequirements, riskAssessment, value, network.usdc.decimals, from);
    if (!policyDecision.allowed) {
      return {
        isValid: false,
        invalidReason: policyDecision.reason,
        payer: from,
        riskAssessment,
      };
    }
    return { isValid: true, payer: from, riskAssessment };
  } catch (err) {
    logger.warn({ err, network: network.caip2, from }, "risk scan failed — proceeding without it");
    return { isValid: true, payer: from };
  }
}
