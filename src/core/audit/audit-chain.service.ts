import { createHash } from "node:crypto";
import { prisma } from "../../storage/prisma.client.js";

/** Fixed link for the very first chained row — there's no real prior hash
 * to reference, and using a constant (rather than e.g. an empty string)
 * makes that reasoning legible in a raw DB dump. */
const GENESIS_HASH = "GENESIS";

/** Everything about a row that's meaningful to the audit trail — excludes
 * its own chain-linkage fields (seq/prevHash/recordHash, obviously can't
 * hash themselves) and its cuid `id`, which carries no audit meaning of
 * its own (unlike, say, `transactionHash`). */
export interface ChainableFields {
  createdAt: Date;
  stage: string;
  network: string;
  resource: string;
  payTo: string;
  asset: string;
  amount: string;
  payer: string | null | undefined;
  isValid: boolean;
  invalidReason: string | null | undefined;
  riskScore: number | null | undefined;
  riskBand: string | null | undefined;
  riskReasons: string | null | undefined;
  settled: boolean | null | undefined;
  transactionHash: string | null | undefined;
  errorReason: string | null | undefined;
}

/** Stable key order (the object literal below, not whatever order the DB
 * driver happens to return columns in) so the same logical row always
 * hashes identically regardless of how it was fetched. */
function canonicalize(fields: ChainableFields): string {
  return JSON.stringify({
    createdAt: fields.createdAt.toISOString(),
    stage: fields.stage,
    network: fields.network,
    resource: fields.resource,
    payTo: fields.payTo,
    asset: fields.asset,
    amount: fields.amount,
    payer: fields.payer ?? null,
    isValid: fields.isValid,
    invalidReason: fields.invalidReason ?? null,
    riskScore: fields.riskScore ?? null,
    riskBand: fields.riskBand ?? null,
    riskReasons: fields.riskReasons ?? null,
    settled: fields.settled ?? null,
    transactionHash: fields.transactionHash ?? null,
    errorReason: fields.errorReason ?? null,
  });
}

export function computeRecordHash(fields: ChainableFields, prevHash: string): string {
  return createHash("sha256").update(prevHash + canonicalize(fields), "utf8").digest("hex");
}

/**
 * Serializes chain-linked inserts within this process. The chain's
 * integrity depends on strict "read the last link, then append" ordering —
 * two concurrent inserts could otherwise both read the same "last hash"
 * before either commits, forking the chain rather than extending it in one
 * line. VAPOR is already a single-instance SQLite service (see
 * docs/DEPLOYMENT.md's "Scaling beyond one instance"); a genuinely
 * multi-writer deployment would need this serialization moved into the
 * database itself (e.g. a Postgres SERIALIZABLE transaction), not just an
 * in-process queue.
 */
let chainQueue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = chainQueue.then(task);
  // Swallow so one failed append doesn't wedge every append after it — the
  // caller of THIS call still sees the real rejection via `result`.
  chainQueue = result.catch(() => undefined);
  return result;
}

export type ChainedRecordInput = Omit<ChainableFields, "createdAt">;

/** Appends one PaymentRecord row, computing and persisting its place in the
 * hash chain. Returns the created row's id. */
export async function appendChainedRecord(data: ChainedRecordInput): Promise<string> {
  return enqueue(async () => {
    const last = await prisma.paymentRecord.findFirst({
      where: { seq: { not: null } },
      orderBy: { seq: "desc" },
      select: { seq: true, recordHash: true },
    });

    const prevHash = last?.recordHash ?? GENESIS_HASH;
    const seq = (last?.seq ?? 0) + 1;
    const createdAt = new Date();
    const recordHash = computeRecordHash({ ...data, createdAt }, prevHash);

    const created = await prisma.paymentRecord.create({
      data: { ...data, createdAt, seq, prevHash, recordHash },
    });
    return created.id;
  });
}

export interface ChainVerificationResult {
  ok: boolean;
  checkedRecords: number;
  brokenAtSeq?: number;
  reason?: string;
}

/** Walks every chained row in seq order, recomputing each one's hash from
 * its own content plus the previous row's (recomputed, not stored) hash.
 * Any mismatch means that row — or something between it and the row
 * before it — was altered or deleted after being written. Rows from
 * before this feature shipped (seq IS NULL) are outside the chain and
 * aren't checked; they were never covered by it in the first place. */
export async function verifyAuditChain(): Promise<ChainVerificationResult> {
  const rows = await prisma.paymentRecord.findMany({
    where: { seq: { not: null } },
    orderBy: { seq: "asc" },
  });

  let prevHash = GENESIS_HASH;
  let expectedSeq = 1;

  for (const row of rows) {
    if (row.seq !== expectedSeq) {
      return {
        ok: false,
        checkedRecords: rows.length,
        brokenAtSeq: row.seq ?? undefined,
        reason: `expected seq ${expectedSeq} but found ${row.seq} — a chained row is missing (deleted?)`,
      };
    }

    const expectedHash = computeRecordHash(row, prevHash);
    if (expectedHash !== row.recordHash) {
      return {
        ok: false,
        checkedRecords: rows.length,
        brokenAtSeq: row.seq,
        reason: "stored recordHash does not match recomputed hash — row content was altered after being written",
      };
    }

    prevHash = row.recordHash ?? GENESIS_HASH;
    expectedSeq += 1;
  }

  return { ok: true, checkedRecords: rows.length };
}
