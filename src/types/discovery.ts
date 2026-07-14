/**
 * x402 Bazaar discovery wire shapes — field names and semantics match the
 * DiscoveryResource / DiscoveryResourcesResponse / SearchDiscoveryResourcesResponse
 * types shipped in @x402/extensions/bazaar (verified directly against that
 * package's compiled type declarations, since docs.x402.org isn't reachable
 * from this build environment). This file has no VAPOR-specific logic, only
 * the wire format any Bazaar-aware client (e.g. `withBazaar()`) expects from
 * a facilitator's discovery endpoints.
 */
import type { PaymentRequirements } from "./x402.js";

export interface DiscoveryResource {
  resource: string;
  type: string;
  x402Version: number;
  accepts: PaymentRequirements[];
  lastUpdated: string;
  description?: string;
  mimeType?: string;
  serviceName?: string;
  tags?: string[];
  iconUrl?: string;
  extensions?: Record<string, unknown>;
}

export interface DiscoveryResourcesResponse {
  x402Version: number;
  items: DiscoveryResource[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
  };
}

export interface SearchDiscoveryResourcesResponse {
  x402Version: number;
  resources: DiscoveryResource[];
  partialResults?: boolean;
  pagination?: {
    limit: number;
    cursor: string | null;
  } | null;
}

export interface ListDiscoveryResourcesParams {
  type?: string;
  payTo?: string;
  scheme?: string;
  network?: string;
  extensions?: string;
  limit?: number;
  offset?: number;
}

export interface SearchDiscoveryResourcesParams {
  query: string;
  type?: string;
  payTo?: string;
  scheme?: string;
  network?: string;
  extensions?: string;
  limit?: number;
}

/**
 * VAPOR's own registration request — not part of the base x402 Bazaar spec
 * (the spec defines how a BUYER reads a catalog, not how a resource server
 * populates one; CDP's own registration path is undocumented and, per
 * x402-foundation/x402#2112, observably broken even for correctly-configured
 * services). This is VAPOR's explicit, documented alternative: a resource
 * server calls this directly instead of relying on an unverified traffic-
 * sniffing mechanism.
 */
export interface RegisterResourceRequest {
  resource: string;
  type?: string;
  x402Version: number;
  accepts: PaymentRequirements[];
  description?: string;
  mimeType?: string;
  serviceName?: string;
  tags?: string[];
  iconUrl?: string;
  extensions?: Record<string, unknown>;
  discoverable?: boolean;
}
