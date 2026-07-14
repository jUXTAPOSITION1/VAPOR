import { Router } from "express";
import {
  getPlatformStats,
  getHourlyTimeseries,
  type PlatformStats,
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

const timeseriesCache = new Map<number, { at: number; points: TimeseriesPoint[] }>();
const TIMESERIES_CACHE_TTL_MS = 30_000;

statsRouter.get("/stats/timeseries", async (req, res) => {
  const hoursParam = Number(req.query.hours);
  const hours = Number.isFinite(hoursParam) && hoursParam > 0 && hoursParam <= 24 * 30 ? hoursParam : 48;

  const cached = timeseriesCache.get(hours);
  if (cached && Date.now() - cached.at <= TIMESERIES_CACHE_TTL_MS) {
    res.status(200).json({ hours, points: cached.points });
    return;
  }

  const points = await getHourlyTimeseries(hours);
  timeseriesCache.set(hours, { at: Date.now(), points });
  res.status(200).json({ hours, points });
});
