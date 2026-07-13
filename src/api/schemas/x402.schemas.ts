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
