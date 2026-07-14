import { z } from "zod";

const hexString = z.string().regex(/^0x[0-9a-fA-F]*$/, "must be a 0x-prefixed hex string");
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x-prefixed 20-byte address");

const exactEvmAuthorizationSchema = z.object({
  from: address,
  to: address,
  value: z.string().regex(/^\d+$/, "must be a base-10 integer string"),
  validAfter: z.string().regex(/^\d+$/),
  validBefore: z.string().regex(/^\d+$/),
  nonce: hexString,
});

const exactEvmPayloadSchema = z.object({
  signature: hexString,
  authorization: exactEvmAuthorizationSchema,
});

const paymentPayloadSchema = z.object({
  x402Version: z.number().int(),
  scheme: z.literal("exact"),
  network: z.string().min(1),
  payload: exactEvmPayloadSchema,
});

const paymentRequirementsSchema = z.object({
  scheme: z.literal("exact"),
  network: z.string().min(1),
  maxAmountRequired: z.string().regex(/^\d+$/),
  resource: z.string().min(1),
  description: z.string().optional(),
  mimeType: z.string().optional(),
  payTo: address,
  maxTimeoutSeconds: z.number().int().positive().optional(),
  asset: address,
  extra: z.record(z.unknown()).optional(),
});

export const verifyRequestSchema = z.object({
  x402Version: z.number().int(),
  paymentPayload: paymentPayloadSchema,
  paymentRequirements: paymentRequirementsSchema,
});

export const settleRequestSchema = verifyRequestSchema;

// Batch size is capped at 10: /settle-batch broadcasts each item sequentially
// against VAPOR's one settlement-signer wallet (see settlement.service.ts's
// nonce-race comment), so a large batch translates directly into request
// latency (each item waits for an on-chain confirmation before the next
// starts) — 10 keeps the worst case within a reasonable HTTP timeout.
const MAX_BATCH_SIZE = 10;

const batchEntrySchema = z.object({
  paymentPayload: paymentPayloadSchema,
  paymentRequirements: paymentRequirementsSchema,
});

export const batchRequestSchema = z.object({
  x402Version: z.number().int(),
  payments: z.array(batchEntrySchema).min(1, "payments must contain at least one entry").max(MAX_BATCH_SIZE, `payments cannot exceed ${MAX_BATCH_SIZE} entries`),
});
