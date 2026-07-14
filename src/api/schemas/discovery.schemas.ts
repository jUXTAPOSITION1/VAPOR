import { z } from "zod";
import { address, paymentRequirementsSchema } from "./x402.schemas.js";

// Mirrors MAX_TAGS/MAX_SERVICE_NAME_LEN/MAX_ICON_URL_LEN from
// @x402/extensions/bazaar's own sanitizeResourceServiceMetadata — matching
// its limits means a listing that validates against VAPOR also validates
// against a real Bazaar client's own expectations.
const MAX_TAGS = 5;
const MAX_TAG_LEN = 32;
const MAX_SERVICE_NAME_LEN = 32;

export const registerResourceSchema = z.object({
  resource: z.string().url("resource must be an absolute URL"),
  type: z.string().min(1).default("http"),
  x402Version: z.number().int().positive(),
  accepts: z.array(paymentRequirementsSchema).min(1, "accepts must contain at least one entry"),
  description: z.string().max(2000).optional(),
  mimeType: z.string().max(255).optional(),
  serviceName: z.string().min(1).max(MAX_SERVICE_NAME_LEN).optional(),
  tags: z.array(z.string().min(1).max(MAX_TAG_LEN)).max(MAX_TAGS).optional(),
  iconUrl: z.string().url().optional(),
  extensions: z.record(z.unknown()).optional(),
  discoverable: z.boolean().default(true),
});

export const listDiscoveryResourcesQuerySchema = z.object({
  type: z.string().optional(),
  payTo: address.optional(),
  scheme: z.string().optional(),
  network: z.string().optional(),
  extensions: z.string().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

export const searchDiscoveryResourcesQuerySchema = listDiscoveryResourcesQuerySchema
  .omit({ offset: true })
  .extend({
    query: z.string().min(1, "query is required"),
    limit: z.coerce.number().int().positive().max(200).default(20),
  });
