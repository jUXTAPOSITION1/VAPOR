import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChainedRecordInput } from "../../src/core/audit/audit-chain.service.js";

// An in-memory fake standing in for prisma.paymentRecord — real DB access
// would either need per-test isolation infrastructure this repo doesn't
// have, or would intermix with whatever other test files wrote to the
// shared test.db in the same run. A fake gives full, deterministic control
// over both normal chaining and the tamper/deletion scenarios below,
// matching how this repo mocks chain.client.js/config elsewhere rather
// than hitting real I/O in unit tests.
interface FakeRow {
  id: string;
  seq: number | null;
  prevHash: string | null;
  recordHash: string | null;
  [key: string]: unknown;
}

let store: FakeRow[] = [];
let nextId = 1;

const fakePaymentRecord = {
  findFirst: vi.fn(async () => {
    const chained = store.filter((r) => r.seq !== null);
    chained.sort((a, b) => (b.seq as number) - (a.seq as number));
    return chained[0] ?? null;
  }),
  findMany: vi.fn(async () => {
    const chained = store.filter((r) => r.seq !== null);
    chained.sort((a, b) => (a.seq as number) - (b.seq as number));
    return chained;
  }),
  create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    const row = { id: `id-${nextId++}`, ...data } as FakeRow;
    store.push(row);
    return row;
  }),
};

vi.mock("../../src/storage/prisma.client.js", () => ({
  prisma: { paymentRecord: fakePaymentRecord },
}));

const { appendChainedRecord, verifyAuditChain, computeRecordHash } = await import(
  "../../src/core/audit/audit-chain.service.js"
);

function sampleRecord(overrides: Partial<ChainedRecordInput> = {}): ChainedRecordInput {
  return {
    stage: "verify",
    network: "eip155:8453",
    resource: "https://example.com/resource",
    payTo: "0x1111111111111111111111111111111111111111",
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    amount: "1000000",
    payer: "0x2222222222222222222222222222222222222222",
    isValid: true,
    invalidReason: undefined,
    riskScore: 10,
    riskBand: "low",
    riskReasons: undefined,
    settled: undefined,
    transactionHash: undefined,
    errorReason: undefined,
    ...overrides,
  };
}

describe("audit hash chain", () => {
  beforeEach(() => {
    store = [];
    nextId = 1;
    vi.clearAllMocks();
  });

  it("computeRecordHash is deterministic and changes when any field changes", () => {
    const createdAt = new Date("2026-01-01T00:00:00Z");
    const base = { ...sampleRecord(), createdAt };
    const h1 = computeRecordHash(base, "GENESIS");
    const h2 = computeRecordHash(base, "GENESIS");
    expect(h1).toBe(h2);

    const changed = { ...base, amount: "999" };
    expect(computeRecordHash(changed, "GENESIS")).not.toBe(h1);

    // Same content, different prevHash — different link in the chain.
    expect(computeRecordHash(base, "some-other-prev-hash")).not.toBe(h1);
  });

  it("assigns strictly increasing seq numbers and links each row's prevHash to the one before it", async () => {
    await appendChainedRecord(sampleRecord());
    await appendChainedRecord(sampleRecord({ stage: "settle" }));

    expect(store).toHaveLength(2);
    expect(store[0]?.seq).toBe(1);
    expect(store[0]?.prevHash).toBe("GENESIS");
    expect(store[1]?.seq).toBe(2);
    expect(store[1]?.prevHash).toBe(store[0]?.recordHash);
  });

  it("serializes concurrent appends instead of racing on the same prevHash", async () => {
    await Promise.all([appendChainedRecord(sampleRecord()), appendChainedRecord(sampleRecord())]);

    const seqs = store.map((r) => r.seq).sort();
    expect(seqs).toEqual([1, 2]);
    expect(store[1]?.prevHash).toBe(store[0]?.recordHash);
  });

  it("verifies a clean, untampered chain as ok", async () => {
    await appendChainedRecord(sampleRecord());
    await appendChainedRecord(sampleRecord());
    await appendChainedRecord(sampleRecord());

    const result = await verifyAuditChain();
    expect(result).toEqual({ ok: true, checkedRecords: 3 });
  });

  it("detects a row whose content was altered after being written", async () => {
    await appendChainedRecord(sampleRecord());
    await appendChainedRecord(sampleRecord());

    const tampered = store.find((r) => r.seq === 1);
    if (tampered) tampered.amount = "999999999";

    const result = await verifyAuditChain();
    expect(result.ok).toBe(false);
    expect(result.brokenAtSeq).toBe(1);
  });

  it("detects a deleted row via the resulting seq gap", async () => {
    await appendChainedRecord(sampleRecord());
    await appendChainedRecord(sampleRecord());
    await appendChainedRecord(sampleRecord());

    store = store.filter((r) => r.seq !== 2);

    const result = await verifyAuditChain();
    expect(result.ok).toBe(false);
    expect(result.brokenAtSeq).toBe(3);
  });
});
