import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RegisterResourceRequest } from "../../src/types/discovery.js";

// A fake standing in for prisma.resourceListing — same reasoning as
// audit-chain.test.ts's fakePaymentRecord: full deterministic control over
// upsert/findMany/count without per-test DB isolation infrastructure.
interface FakeRow {
  id: string;
  resource: string;
  payTo: string;
  type: string;
  scheme: string;
  network: string;
  x402Version: number;
  accepts: string;
  description: string | null;
  mimeType: string | null;
  serviceName: string | null;
  tags: string | null;
  iconUrl: string | null;
  extensions: string | null;
  discoverable: boolean;
  updatedAt: Date;
}

let store: FakeRow[] = [];
let nextId = 1;

function matchesWhere(row: FakeRow, where: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(where)) {
    if (value === undefined) continue;
    if (key === "extensions" && value && typeof value === "object" && "contains" in (value as object)) {
      const needle = (value as { contains: string }).contains;
      if (!row.extensions || !row.extensions.includes(needle)) return false;
      continue;
    }
    if ((row as Record<string, unknown>)[key] !== value) return false;
  }
  return true;
}

const fakeResourceListing = {
  upsert: vi.fn(async ({ where, create, update }: { where: { resource_payTo: { resource: string; payTo: string } }; create: FakeRow; update: Partial<FakeRow> }) => {
    const existing = store.find((r) => r.resource === where.resource_payTo.resource && r.payTo === where.resource_payTo.payTo);
    if (existing) {
      Object.assign(existing, update, { updatedAt: new Date() });
      return existing;
    }
    const row: FakeRow = { id: `id-${nextId++}`, updatedAt: new Date(), ...create } as FakeRow;
    store.push(row);
    return row;
  }),
  findMany: vi.fn(async ({ where, orderBy, take, skip }: { where: Record<string, unknown>; orderBy?: unknown; take?: number; skip?: number }) => {
    let rows = store.filter((r) => matchesWhere(r, where));
    rows = rows.slice().sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    if (skip !== undefined) rows = rows.slice(skip);
    if (take !== undefined) rows = rows.slice(0, take);
    return rows;
  }),
  count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => store.filter((r) => matchesWhere(r, where)).length),
};

vi.mock("../../src/storage/prisma.client.js", () => ({
  prisma: { resourceListing: fakeResourceListing },
}));

const { registerResource, listResources, searchResources, matchesQuery, RegistrationError } = await import(
  "../../src/core/discovery/discovery.service.js"
);

const PAY_TO = "0x1111111111111111111111111111111111111111" as `0x${string}`;
const OTHER_PAY_TO = "0x2222222222222222222222222222222222222222" as `0x${string}`;

function sampleInput(overrides: Partial<RegisterResourceRequest> = {}): RegisterResourceRequest {
  return {
    resource: "https://example.com/data/token_intel",
    x402Version: 1,
    accepts: [
      {
        scheme: "exact",
        network: "eip155:8453",
        maxAmountRequired: "10000",
        resource: "https://example.com/data/token_intel",
        payTo: PAY_TO,
        asset: "0x3333333333333333333333333333333333333333",
      },
    ],
    description: "Token price and confidence intel",
    serviceName: "ExampleAgent",
    tags: ["price-oracle", "token"],
    ...overrides,
  };
}

describe("registerResource", () => {
  beforeEach(() => {
    store = [];
    nextId = 1;
    vi.clearAllMocks();
  });

  it("registers a new listing, deriving payTo from accepts[0]", async () => {
    const result = await registerResource(sampleInput());
    expect(result.resource).toBe("https://example.com/data/token_intel");
    expect(result.accepts[0]?.payTo).toBe(PAY_TO);
    expect(store).toHaveLength(1);
  });

  it("upserts (refreshes) an existing listing rather than duplicating it", async () => {
    await registerResource(sampleInput());
    await registerResource(sampleInput({ description: "Updated description" }));
    expect(store).toHaveLength(1);
    expect(store[0]?.description).toBe("Updated description");
  });

  it("rejects accepts entries that disagree on payTo", async () => {
    const input = sampleInput({
      accepts: [
        ...sampleInput().accepts,
        { ...sampleInput().accepts[0]!, payTo: OTHER_PAY_TO },
      ],
    });
    await expect(registerResource(input)).rejects.toThrow(RegistrationError);
  });

  it("rejects a scoped API key registering a listing for a different payTo", async () => {
    await expect(registerResource(sampleInput(), OTHER_PAY_TO)).rejects.toThrow(RegistrationError);
  });

  it("allows a scoped API key registering its own payTo", async () => {
    const result = await registerResource(sampleInput(), PAY_TO);
    expect(result.accepts[0]?.payTo).toBe(PAY_TO);
  });

  it("re-registering with discoverable:false soft-unlists the listing", async () => {
    await registerResource(sampleInput());
    await registerResource(sampleInput({ discoverable: false }));
    const { items } = await listResources({});
    expect(items).toHaveLength(0);
  });
});

describe("listResources", () => {
  beforeEach(() => {
    store = [];
    nextId = 1;
  });

  it("returns an empty, well-formed page when nothing is registered", async () => {
    const response = await listResources({});
    expect(response.items).toEqual([]);
    expect(response.pagination).toEqual({ limit: 50, offset: 0, total: 0 });
    expect(response.x402Version).toBe(2);
  });

  it("filters by payTo, scheme, and network", async () => {
    await registerResource(sampleInput());
    await registerResource(sampleInput({ resource: "https://example.com/data/bridges", accepts: [{ ...sampleInput().accepts[0]!, payTo: OTHER_PAY_TO }] }));

    const filtered = await listResources({ payTo: PAY_TO });
    expect(filtered.items).toHaveLength(1);
    expect(filtered.items[0]?.resource).toBe("https://example.com/data/token_intel");
  });

  it("paginates with limit/offset and reports the true total", async () => {
    for (let i = 0; i < 3; i++) {
      await registerResource(sampleInput({ resource: `https://example.com/data/tool-${i}` }));
    }
    const page = await listResources({ limit: 2, offset: 1 });
    expect(page.items).toHaveLength(2);
    expect(page.pagination).toEqual({ limit: 2, offset: 1, total: 3 });
  });
});

describe("matchesQuery", () => {
  const resource = {
    resource: "https://example.com/data/token_intel",
    type: "http",
    x402Version: 1,
    accepts: [],
    lastUpdated: new Date().toISOString(),
    description: "Token price and confidence intel",
    serviceName: "ExampleAgent",
    tags: ["price-oracle", "token", "base"],
  };

  it("matches on a single term found in description", () => {
    expect(matchesQuery(resource, "price")).toBe(true);
  });

  it("matches on a term found only in tags", () => {
    expect(matchesQuery(resource, "base")).toBe(true);
  });

  it("requires every term to match somewhere (AND semantics)", () => {
    expect(matchesQuery(resource, "price nonexistentterm")).toBe(false);
    expect(matchesQuery(resource, "price token")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(matchesQuery(resource, "PRICE")).toBe(true);
  });

  it("does not match an unrelated query", () => {
    expect(matchesQuery(resource, "bridges volume")).toBe(false);
  });
});

describe("searchResources", () => {
  beforeEach(() => {
    store = [];
    nextId = 1;
  });

  it("returns only listings whose fields match every query term", async () => {
    await registerResource(sampleInput());
    await registerResource(
      sampleInput({
        resource: "https://example.com/data/bridges",
        description: "Bridge volume rankings",
        serviceName: "ExampleAgent",
        tags: ["bridges", "volume"],
      })
    );

    const result = await searchResources({ query: "bridge" });
    expect(result.resources).toHaveLength(1);
    expect(result.resources[0]?.resource).toBe("https://example.com/data/bridges");
    expect(result.x402Version).toBe(2);
  });

  it("marks partialResults when matches exceed the requested limit", async () => {
    for (let i = 0; i < 3; i++) {
      await registerResource(
        sampleInput({ resource: `https://example.com/data/oracle-${i}`, description: "oracle tool", tags: ["oracle"] })
      );
    }
    const result = await searchResources({ query: "oracle", limit: 2 });
    expect(result.resources).toHaveLength(2);
    expect(result.partialResults).toBe(true);
  });
});
