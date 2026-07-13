import { prisma } from "../../storage/prisma.client.js";

export interface PayeeSummary {
  payTo: string;
  totalRequests: number;
  validCount: number;
  settledCount: number;
  totalSettledVolume: string; // raw token units, summed as bigint then stringified
  averageRiskScore: number | null;
  riskBandCounts: Record<string, number>;
}

/** Aggregated analytics for a single payee — the data behind VAPOR's
 * payee dashboard. Reads straight from the audit log, so it's always
 * consistent with what /verify and /settle actually recorded. */
export async function getPayeeSummary(payTo: string): Promise<PayeeSummary> {
  const records = await prisma.paymentRecord.findMany({ where: { payTo } });

  let validCount = 0;
  let settledCount = 0;
  let settledVolume = 0n;
  let riskScoreSum = 0;
  let riskScoreCount = 0;
  const riskBandCounts: Record<string, number> = {};

  for (const record of records) {
    if (record.isValid) validCount++;
    if (record.settled) {
      settledCount++;
      try {
        settledVolume += BigInt(record.amount);
      } catch {
        // malformed stored amount — skip rather than throw off the whole summary
      }
    }
    if (record.riskScore !== null && record.riskScore !== undefined) {
      riskScoreSum += record.riskScore;
      riskScoreCount++;
    }
    if (record.riskBand) {
      riskBandCounts[record.riskBand] = (riskBandCounts[record.riskBand] ?? 0) + 1;
    }
  }

  return {
    payTo,
    totalRequests: records.length,
    validCount,
    settledCount,
    totalSettledVolume: settledVolume.toString(),
    averageRiskScore: riskScoreCount > 0 ? riskScoreSum / riskScoreCount : null,
    riskBandCounts,
  };
}

export interface AuditExportOptions {
  payTo: string;
  from?: Date;
  to?: Date;
}

/** Full audit-grade export for a payee — every field that went into every
 * verify/settle decision, in chronological order, ready for a payee's own
 * compliance record-keeping. */
export async function exportAuditLog(options: AuditExportOptions) {
  const { payTo, from, to } = options;
  return prisma.paymentRecord.findMany({
    where: {
      payTo,
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
    },
    orderBy: { createdAt: "asc" },
  });
}

/** Renders audit records as CSV — no external dependency needed for a
 * flat, fixed-column table like this. */
export function auditLogToCsv(records: Awaited<ReturnType<typeof exportAuditLog>>): string {
  const columns = [
    "id",
    "createdAt",
    "stage",
    "network",
    "resource",
    "payTo",
    "asset",
    "amount",
    "payer",
    "isValid",
    "invalidReason",
    "riskScore",
    "riskBand",
    "settled",
    "transactionHash",
    "errorReason",
  ] as const;

  const escape = (value: unknown): string => {
    if (value === null || value === undefined) return "";
    const str = value instanceof Date ? value.toISOString() : String(value);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };

  const header = columns.join(",");
  const rows = records.map((record) => columns.map((col) => escape((record as Record<string, unknown>)[col])).join(","));
  return [header, ...rows].join("\n");
}
