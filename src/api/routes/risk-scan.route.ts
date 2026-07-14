import { Router } from "express";
import { getAddress } from "viem";
import { resolveNetwork } from "../../config/networks.js";
import { scanAddress } from "../../core/risk/risk-scanner.service.js";
import { scanRateLimit } from "../middleware/rate-limit.middleware.js";

export const riskScanRouter = Router();

// Path-scoped (not a bare `.use(scanRateLimit)`) so it only ever matches
// "/risk-scan*" — see rate-limit.middleware.ts's docstring on why a router-
// level `.use()` with no path would leak onto unrelated routes. Passing the
// limiter as a third argument directly to `.get()` below would ALSO work at
// runtime, but breaks TypeScript's path-literal param inference for
// `req.params.address` (every other Express handler in this repo hits the
// same issue if a generically-typed middleware is inlined next to a
// parameterized route) — this form avoids that entirely.
riskScanRouter.use("/risk-scan", scanRateLimit);

/**
 * Standalone access to VAPOR's risk scanner, independent of a payment
 * flow — a payee can pre-screen an address (e.g. at signup or before
 * quoting a price) rather than only learning risk at payment time.
 */
riskScanRouter.get("/risk-scan/:address", async (req, res) => {
  const network = resolveNetwork(String(req.query.network ?? ""));
  if (!network) {
    res.status(400).json({ error: "missing or unsupported ?network= (expected a CAIP-2 id, e.g. eip155:8453)" });
    return;
  }

  let address: `0x${string}`;
  try {
    address = getAddress(req.params.address);
  } catch {
    res.status(400).json({ error: "malformed address" });
    return;
  }

  const riskAssessment = await scanAddress(network, address);
  res.status(200).json({ address, network: network.caip2, riskAssessment });
});
