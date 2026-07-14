import { Router } from "express";
import {
  getPlatformStats,
  getTimeseries,
  type PlatformStats,
  type TimeseriesBucket,
  type TimeseriesPoint,
} from "../../core/analytics/analytics.service.js";

export const statsRouter = Router();

/** Short in-memory cache — the public dashboard polls this frequently from
 * many concurrent viewers; there's no reason each of them to trigger its
 * own set of DB aggregate queries a few seconds apart. */
let statsCache: { at: number; stats: PlatformStats } | null = null;
const STATS_CACHE_TTL_MS = 5_000;

statsRouter.get("/stats", async (_req, res) => {
  if (!statsCache || Date.now() - statsCache.at > STATS_CACHE_TTL_MS) {
    statsCache = { at: Date.now(), stats: await getPlatformStats() };
  }
  res.status(200).json(statsCache.stats);
});

// Up to 8760 hours (365 days) — a full year. Cache key includes bucket so
// an hourly and a daily request for the same `hours` never collide.
const MAX_TIMESERIES_HOURS = 24 * 365;
// Beyond a week, hourly buckets (168+ points) get dense enough that daily
// is the more readable default when the caller doesn't ask for a specific
// granularity — this only affects the auto-selected default; an explicit
// ?bucket= always wins.
const AUTO_DAILY_THRESHOLD_HOURS = 24 * 7;

const timeseriesCache = new Map<string, { at: number; points: TimeseriesPoint[] }>();
const TIMESERIES_CACHE_TTL_MS = 30_000;

statsRouter.get("/stats/timeseries", async (req, res) => {
  const hoursParam = Number(req.query.hours);
  const hours =
    Number.isFinite(hoursParam) && hoursParam > 0 && hoursParam <= MAX_TIMESERIES_HOURS ? hoursParam : 48;

  const bucketParam = String(req.query.bucket ?? "");
  const bucket: TimeseriesBucket =
    bucketParam === "hour" || bucketParam === "day"
      ? bucketParam
      : hours > AUTO_DAILY_THRESHOLD_HOURS
        ? "day"
        : "hour";

  const cacheKey = `${hours}:${bucket}`;
  const cached = timeseriesCache.get(cacheKey);
  if (cached && Date.now() - cached.at <= TIMESERIES_CACHE_TTL_MS) {
    res.status(200).json({ hours, bucket, points: cached.points });
    return;
  }

  const points = await getTimeseries(hours, bucket);
  timeseriesCache.set(cacheKey, { at: Date.now(), points });
  res.status(200).json({ hours, bucket, points });
});
