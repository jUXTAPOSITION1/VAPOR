import { Router } from "express";
import { getAddress } from "viem";
import { getPayeeSummary, exportAuditLog, auditLogToCsv } from "../../core/analytics/analytics.service.js";
import { requireApiKey } from "../middleware/auth.middleware.js";

export const analyticsRouter = Router();

// Path-scoped (matches only "/analytics*", never leaks to sibling routes —
// see rate-limit.middleware.ts's docstring for the general reasoning, and
// risk-scan.route.ts's for why this form avoids breaking TS's path-literal
// param inference the way an inline third handler argument would).
analyticsRouter.use("/analytics", requireApiKey);

analyticsRouter.get("/analytics/:payTo", async (req, res) => {
  let payTo: string;
  try {
    payTo = getAddress(req.params.payTo);
  } catch {
    res.status(400).json({ error: "malformed payTo address" });
    return;
  }

  const summary = await getPayeeSummary(payTo);
  res.status(200).json(summary);
});

analyticsRouter.get("/analytics/:payTo/export", async (req, res) => {
  let payTo: string;
  try {
    payTo = getAddress(req.params.payTo);
  } catch {
    res.status(400).json({ error: "malformed payTo address" });
    return;
  }

  const from = req.query.from ? new Date(String(req.query.from)) : undefined;
  const to = req.query.to ? new Date(String(req.query.to)) : undefined;
  const format = req.query.format === "csv" ? "csv" : "json";

  const records = await exportAuditLog({ payTo, from, to });

  if (format === "csv") {
    res.setHeader("content-type", "text/csv");
    res.setHeader("content-disposition", `attachment; filename="vapor-audit-${payTo}.csv"`);
    res.status(200).send(auditLogToCsv(records));
    return;
  }

  res.status(200).json(records);
});
