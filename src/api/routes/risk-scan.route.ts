import { Router } from "express";
import { getAddress } from "viem";
import { resolveNetwork } from "../../config/networks.js";
import { scanAddress } from "../../core/risk/risk-scanner.service.js";

export const riskScanRouter = Router();

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
