import {
  upsertResourceListing,
  findResourceListings,
  findAllDiscoverableListings,
  type ResourceListingFilter,
} from "../../storage/repositories/resource-listing.repository.js";
import type {
  RegisterResourceRequest,
  DiscoveryResource,
  DiscoveryResourcesResponse,
  SearchDiscoveryResourcesResponse,
  ListDiscoveryResourcesParams,
  SearchDiscoveryResourcesParams,
} from "../../types/discovery.js";

// The x402 protocol version these discovery responses speak — matches the
// "exact"-over-EIP-3009 PaymentPayload/PaymentRequirements shapes this
// facilitator already verifies and settles (see src/types/x402.ts), and
// must track supported.route.ts's own X402_VERSION (currently 2, per
// @x402/core >=2.18 — see that file's comment for why a stale value
// here breaks every x402 client on the current SDK).
const X402_VERSION = 2;

export class RegistrationError extends Error {}

/** A row backing store agnostic representation the service works against —
 * decouples registerResource/listResources/searchResources from Prisma's
 * generated row type so onlyToDiscoveryResource() has one place that knows
 * the JSON-encoding convention (see resource-listing.repository.ts). */
interface ListingRow {
  resource: string;
  type: string;
  x402Version: number;
  accepts: string;
  updatedAt: Date;
  description: string | null;
  mimeType: string | null;
  serviceName: string | null;
  tags: string | null;
  iconUrl: string | null;
  extensions: string | null;
}

function toDiscoveryResource(row: ListingRow): DiscoveryResource {
  return {
    resource: row.resource,
    type: row.type,
    x402Version: row.x402Version,
    accepts: JSON.parse(row.accepts),
    lastUpdated: row.updatedAt.toISOString(),
    description: row.description ?? undefined,
    mimeType: row.mimeType ?? undefined,
    serviceName: row.serviceName ?? undefined,
    tags: row.tags ? JSON.parse(row.tags) : undefined,
    iconUrl: row.iconUrl ?? undefined,
    extensions: row.extensions ? JSON.parse(row.extensions) : undefined,
  };
}

/**
 * Registers (or refreshes) one resource server's discovery listing.
 *
 * `authorizedPayTo` is the caller's API-key scope (undefined for an
 * unscoped key) — when present, every entry in `input.accepts` must pay to
 * that exact address, the same trust model /analytics/:payTo already uses
 * (a key can only act on behalf of the payTo it was issued for). All
 * `accepts` entries must also agree with EACH OTHER on payTo, since a
 * listing is stored as one row keyed by one payTo — a resource that
 * genuinely accepts payment to different addresses for different schemes
 * needs separate listings (one per resource+payTo pair), not one row that
 * can't represent it.
 */
export async function registerResource(
  input: RegisterResourceRequest,
  authorizedPayTo?: `0x${string}`
): Promise<DiscoveryResource> {
  const payTos = new Set(input.accepts.map((a) => a.payTo));
  if (payTos.size > 1) {
    throw new RegistrationError("all `accepts` entries must share the same payTo for one listing");
  }
  const payTo = input.accepts[0]?.payTo;
  if (!payTo) {
    throw new RegistrationError("accepts must contain at least one entry");
  }
  if (authorizedPayTo && payTo !== authorizedPayTo) {
    throw new RegistrationError("API key is not scoped to this listing's payTo");
  }

  const row = await upsertResourceListing(payTo, input);
  return toDiscoveryResource(row);
}

export async function listResources(params: ListDiscoveryResourcesParams): Promise<DiscoveryResourcesResponse> {
  const limit = params.limit ?? 50;
  const offset = params.offset ?? 0;
  const filter: ResourceListingFilter = {
    type: params.type,
    payTo: params.payTo,
    scheme: params.scheme,
    network: params.network,
    extensionKey: params.extensions,
  };
  const { rows, total } = await findResourceListings(filter, limit, offset);
  return {
    x402Version: X402_VERSION,
    items: rows.map(toDiscoveryResource),
    pagination: { limit, offset, total },
  };
}

/** Deterministic, rule-based substring match over description/serviceName/
 * tags — no embeddings, no fabricated relevance score. A listing matches if
 * every whitespace-separated term in the query appears (case-insensitively)
 * in at least one of those fields; that's a real, explainable relevance
 * rule rather than a semantic model this repo has no way to ground. */
export function matchesQuery(resource: DiscoveryResource, query: string): boolean {
  const haystack = [resource.description ?? "", resource.serviceName ?? "", ...(resource.tags ?? [])]
    .join(" ")
    .toLowerCase();
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return terms.every((term) => haystack.includes(term));
}

export async function searchResources(params: SearchDiscoveryResourcesParams): Promise<SearchDiscoveryResourcesResponse> {
  const limit = params.limit ?? 20;
  const filter: ResourceListingFilter = {
    type: params.type,
    payTo: params.payTo,
    scheme: params.scheme,
    network: params.network,
    extensionKey: params.extensions,
  };
  const all = await findAllDiscoverableListings(filter);
  const matched = all.map(toDiscoveryResource).filter((r) => matchesQuery(r, params.query));
  const partialResults = matched.length > limit;
  return {
    x402Version: X402_VERSION,
    resources: matched.slice(0, limit),
    partialResults: partialResults || undefined,
  };
}
