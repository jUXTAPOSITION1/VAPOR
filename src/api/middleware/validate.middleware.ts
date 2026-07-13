import type { NextFunction, Request, Response } from "express";
import type { ZodSchema } from "zod";

/** Validates req.body against a zod schema, replacing it with the parsed
 * (and thus type-narrowed) value on success, or responding 400 on failure —
 * malformed requests are rejected before any signature or RPC work runs. */
export function validateBody(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: "invalid request body",
        details: result.error.flatten(),
      });
      return;
    }
    req.body = result.data;
    next();
  };
}
