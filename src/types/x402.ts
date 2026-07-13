/**
 * Core x402 protocol shapes — the "exact" scheme over EIP-3009
 * (transferWithAuthorization) on EVM chains. Field names and semantics
 * match the published x402 specification; this file has no VAPOR-specific
 * logic, only the wire format every facilitator speaks.
 */

export interface ExactEvmAuthorization {
  from: `0x${string}`;
  to: `0x${string}`;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: `0x${string}`;
}

export interface ExactEvmPayload {
  signature: `0x${string}`;
  authorization: ExactEvmAuthorization;
}

export interface PaymentPayload {
  x402Version: number;
  scheme: "exact";
  network: string; // CAIP-2, e.g. "eip155:8453"
  payload: ExactEvmPayload;
}

export interface PaymentRequirements {
  scheme: "exact";
  network: string;
  maxAmountRequired: string;
  resource: string;
  description?: string;
  mimeType?: string;
  payTo: `0x${string}`;
  maxTimeoutSeconds?: number;
  asset: `0x${string}`;
  extra?: Record<string, unknown>;
}

export interface VerifyRequest {
  x402Version: number;
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
}

export interface VerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  payer?: `0x${string}`;
  /** VAPOR extension — never present in the base spec, always additive.
   * A resource server that doesn't know about it just ignores the field. */
  riskAssessment?: RiskAssessment;
}

export interface SettleRequest {
  x402Version: number;
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
}

export interface SettleResponse {
  success: boolean;
  errorReason?: string;
  payer?: `0x${string}`;
  transaction: string;
  network: string;
  amount?: string;
}

export interface SupportedKind {
  scheme: "exact";
  network: string;
}

export interface SupportedResponse {
  kinds: SupportedKind[];
}

/** VAPOR's own extension type, not part of the base x402 spec. */
export interface RiskAssessment {
  score: number; // 0 (clean) .. 100 (severe)
  band: "low" | "medium" | "high" | "severe";
  reasons: string[];
  checkedAt: string;
}
