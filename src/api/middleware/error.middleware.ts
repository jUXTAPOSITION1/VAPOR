import type { NextFunction, Request, Response } from "express";
import { logger } from "../../utils/logger.js";

/** Last-resort handler — anything thrown and not already caught inside a
 * route lands here. Never leaks internals (stack traces, error messages
 * from dependencies) into the response body. */
export function errorMiddleware(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  logger.error({ err, path: req.path, method: req.method }, "unhandled request error");
  if (res.headersSent) return;
  res.status(500).json({ error: "internal server error" });
}
