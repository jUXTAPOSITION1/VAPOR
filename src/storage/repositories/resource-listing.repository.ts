import { prisma } from "../prisma.client.js";
import type { RegisterResourceRequest } from "../../types/discovery.js";

export interface ResourceListingFilter {
  type?: string;
  payTo?: string;
  scheme?: string;
  network?: string;
  /** Filter to listings whose stored `extensions` JSON has this top-level key. */
  extensionKey?: string;
}

/** Upserts by the (resource, payTo) unique key — a resource server
 * re-registering the same route just refreshes its existing listing
 * (including flipping `discoverable` to soft-unlist it) rather than
 * creating a duplicate. */
export async function upsertResourceListing(payTo: string, input: RegisterResourceRequest) {
  const scheme = input.accepts[0]?.scheme ?? "exact";
  const network = input.accepts[0]?.network ?? "";
  const data = {
    type: input.type ?? "http",
    x402Version: input.x402Version,
    payTo,
    scheme,
    network,
    accepts: JSON.stringify(input.accepts),
    description: input.description,
    mimeType: input.mimeType,
    serviceName: input.serviceName,
    tags: input.tags ? JSON.stringify(input.tags) : undefined,
    iconUrl: input.iconUrl,
    extensions: input.extensions ? JSON.stringify(input.extensions) : undefined,
    discoverable: input.discoverable ?? true,
  };
  return prisma.resourceListing.upsert({
    where: { resource_payTo: { resource: input.resource, payTo } },
    create: { resource: input.resource, ...data },
    update: data,
  });
}

export async function findResourceListings(filter: ResourceListingFilter, limit: number, offset: number) {
  const where = buildWhere(filter);
  const [rows, total] = await Promise.all([
    prisma.resourceListing.findMany({ where, orderBy: { updatedAt: "desc" }, take: limit, skip: offset }),
    prisma.resourceListing.count({ where }),
  ]);
  return { rows, total };
}

/** No full-text index in SQLite/Postgres-agnostic Prisma here, so the
 * candidate set is filtered structurally in SQL (cheap, indexed columns)
 * and the natural-language `query` match itself happens in JS over that
 * bounded set — see discovery.service.ts's matchesQuery(). Deterministic
 * substring matching, not semantic search: an honest, rule-based search
 * over real listings rather than a fabricated relevance model. */
export async function findAllDiscoverableListings(filter: ResourceListingFilter) {
  const where = buildWhere(filter);
  return prisma.resourceListing.findMany({ where, orderBy: { updatedAt: "desc" } });
}

function buildWhere(filter: ResourceListingFilter) {
  return {
    discoverable: true,
    ...(filter.type ? { type: filter.type } : {}),
    ...(filter.payTo ? { payTo: filter.payTo } : {}),
    ...(filter.scheme ? { scheme: filter.scheme } : {}),
    ...(filter.network ? { network: filter.network } : {}),
    ...(filter.extensionKey ? { extensions: { contains: `"${filter.extensionKey}"` } } : {}),
  };
}
