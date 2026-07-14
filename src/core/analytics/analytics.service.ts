import { prisma } from "../../storage/prisma.client.js";
import { activeNetworks } from "../../config/networks.js";

const processStartedAt = Date.now();

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

export interface PlatformStats {
  generatedAt: string;
  uptimeSeconds: number;
  networks: string[];
  totals: {
    verifyRequests: number;
    settleRequests: number;
    validVerifyCount: number;
    settledCount: number;
    settledVolumeRaw: string;
    settledVolumeUsd: number;
  };
  averageRiskScore: number | null;
  riskBandCounts: Record<string, number>;
  /** Webhook delivery health — pending/delivered/failed counts across
   * every dispatch VAPOR has ever queued for retry (see webhook.service.ts).
   * Deliveries that succeeded on the first attempt are never persisted, so
   * this only reflects deliveries that needed at least one retry. */
  webhookDeliveries: Record<string, number>;
}

/**
 * Platform-wide aggregate stats — the data behind VAPOR's public live
 * dashboard. Deliberately never includes payTo/payer addresses or anything
 * payee-specific; this is the one analytics surface meant to be public and
 * unauthenticated. Uses count/groupBy aggregates rather than pulling every
 * row, since (unlike a single payee's history) this table only grows.
 */
export async function getPlatformStats(): Promise<PlatformStats> {
  const [
    verifyRequests,
    settleRequests,
    validVerifyCount,
    settledCount,
    riskAvg,
    riskBandGroups,
    settledAmounts,
    webhookGroups,
  ] = await Promise.all([
    prisma.paymentRecord.count({ where: { stage: "verify" } }),
    prisma.paymentRecord.count({ where: { stage: "settle" } }),
    prisma.paymentRecord.count({ where: { stage: "verify", isValid: true } }),
    prisma.paymentRecord.count({ where: { stage: "settle", settled: true } }),
    prisma.paymentRecord.aggregate({ _avg: { riskScore: true }, where: { riskScore: { not: null } } }),
    prisma.paymentRecord.groupBy({
      by: ["riskBand"],
      _count: { riskBand: true },
      where: { riskBand: { not: null } },
    }),
    prisma.paymentRecord.findMany({
      where: { stage: "settle", settled: true },
      select: { amount: true },
    }),
    prisma.webhookDelivery.groupBy({ by: ["status"], _count: { status: true } }),
  ]);

  let settledVolumeRaw = 0n;
  for (const { amount } of settledAmounts) {
    try {
      settledVolumeRaw += BigInt(amount);
    } catch {
      // malformed stored amount — skip rather than throw off the whole summary
    }
  }

  const riskBandCounts: Record<string, number> = {};
  for (const group of riskBandGroups) {
    if (group.riskBand) riskBandCounts[group.riskBand] = group._count.riskBand;
  }

  const webhookDeliveries: Record<string, number> = {};
  for (const group of webhookGroups) {
    webhookDeliveries[group.status] = group._count.status;
  }

  // USDC is the only supported asset today, always 6 decimals — see
  // src/config/networks.ts. Revisit if a non-6-decimal asset is added.
  const settledVolumeUsd = Number(settledVolumeRaw) / 1_000_000;

  return {
    generatedAt: new Date().toISOString(),
    uptimeSeconds: Math.floor((Date.now() - processStartedAt) / 1000),
    networks: activeNetworks().map((n) => n.caip2),
    totals: {
      verifyRequests,
      settleRequests,
      validVerifyCount,
      settledCount,
      settledVolumeRaw: settledVolumeRaw.toString(),
      settledVolumeUsd,
    },
    averageRiskScore: riskAvg._avg.riskScore,
    riskBandCounts,
    webhookDeliveries,
  };
}

export interface TimeseriesPoint {
  bucket: string; // ISO hour start, e.g. "2026-07-14T04:00:00Z"
  verifyCount: number;
  settleCount: number;
  settledVolumeUsd: number;
}

interface TimeseriesRow {
  bucket: string;
  stage: string;
  count: bigint | number;
  volume: bigint | number | null;
}

/**
 * Real hourly activity buckets derived directly from stored request
 * timestamps — not a fabricated or simulated series. Powers the dashboard's
 * "activity over time" chart. Uses a raw query because SQLite date
 * truncation/grouping isn't expressible through Prisma's query builder.
 */
export async function getHourlyTimeseries(hours = 48): Promise<TimeseriesPoint[]> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const rows = await prisma.$queryRaw<TimeseriesRow[]>`
    SELECT
      strftime('%Y-%m-%dT%H:00:00Z', createdAt) as bucket,
      stage,
      COUNT(*) as count,
      SUM(CASE WHEN stage = 'settle' AND settled = 1 THEN CAST(amount AS INTEGER) ELSE 0 END) as volume
    FROM PaymentRecord
    WHERE createdAt >= ${since.toISOString()}
    GROUP BY bucket, stage
    ORDER BY bucket ASC
  `;

  const byBucket = new Map<string, TimeseriesPoint>();
  for (const row of rows) {
    const point = byBucket.get(row.bucket) ?? {
      bucket: row.bucket,
      verifyCount: 0,
      settleCount: 0,
      settledVolumeUsd: 0,
    };
    const count = Number(row.count);
    if (row.stage === "verify") point.verifyCount = count;
    if (row.stage === "settle") {
      point.settleCount = count;
      point.settledVolumeUsd = Number(row.volume ?? 0) / 1_000_000;
    }
    byBucket.set(row.bucket, point);
  }

  return [...byBucket.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));
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
