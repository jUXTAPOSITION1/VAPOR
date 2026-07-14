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

/**
 * VAPOR extensions, not part of the base x402 spec: a convenience for a
 * payer settling several independent "exact"-scheme payments in one HTTP
 * call instead of one round trip each. Each entry is a completely normal,
 * standalone signed EIP-3009 authorization — this is not the real on-chain
 * escrow/voucher "batch-settlement" scheme (x402Version 2, stateful payment
 * channels); it's N ordinary payments processed together for convenience,
 * still settling as N separate on-chain transactions.
 */
export interface BatchVerifyRequest {
  x402Version: number;
  payments: Array<{ paymentPayload: PaymentPayload; paymentRequirements: PaymentRequirements }>;
}

export interface BatchVerifyResponse {
  results: VerifyResponse[];
}

export interface BatchSettleRequest {
  x402Version: number;
  payments: Array<{ paymentPayload: PaymentPayload; paymentRequirements: PaymentRequirements }>;
}

export interface BatchSettleResponse {
  results: SettleResponse[];
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

/**
 * VAPOR's own extension type — the mirror-image of RiskAssessment, but for
 * the payee/service side rather than the payer. Positively framed (higher
 * is more established/trustworthy) rather than risk-framed, because "new
 * service with zero history" and "compromised/scam service" are different
 * conditions a payer needs to tell apart, not points on the same scale.
 */
export interface PayeeReputation {
  payTo: `0x${string}`;
  score: number; // 0 (unknown/new) .. 100 (established, high-volume, clean)
  band: "new" | "emerging" | "established" | "veteran";
  history: {
    totalVerifyRequests: number;
    totalSettlements: number;
    settlementSuccessRate: number | null; // settlements / verify-valid requests
    totalSettledVolumeUsd: number;
    firstSeenAt: string | null;
  };
  flaggedByReputationProvider: boolean;
  reasons: string[];
  checkedAt: string;
  /** Opt-in only: present when the caller supplied an ERC-8004 agentId
   * (via ?agentId=) AND that agentId's on-chain claimed wallet actually
   * matches payTo. VAPOR never guesses or reverse-looks-up an agentId —
   * an address with no claimed agentId simply has no erc8004 field. */
  erc8004?: {
    agentId: string;
    verified: boolean;
    feedbackCount: number;
    averageScore: number | null;
  };
}
