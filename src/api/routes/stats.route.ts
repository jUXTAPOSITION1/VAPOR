import { Router } from "express";
import { getPlatformStats, type PlatformStats } from "../../core/analytics/analytics.service.js";

export const statsRouter = Router();

/** Short in-memory cache — the public dashboard polls this frequently from
 * many concurrent viewers; there's no reason each of them to trigger its
 * own set of DB aggregate queries a few seconds apart. */
let cached: { at: number; stats: PlatformStats } | null = null;
const CACHE_TTL_MS = 5_000;

statsRouter.get("/stats", async (_req, res) => {
  if (!cached || Date.now() - cached.at > CACHE_TTL_MS) {
    cached = { at: Date.now(), stats: await getPlatformStats() };
  }
  res.status(200).json(cached.stats);
});
