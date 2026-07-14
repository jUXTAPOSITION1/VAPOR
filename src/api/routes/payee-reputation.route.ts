import { Router } from "express";
import { getAddress } from "viem";
import { resolveNetwork } from "../../config/networks.js";
import { scorePayee } from "../../core/reputation/payee-reputation.service.js";

export const payeeReputationRouter = Router();

/**
 * Lets a payer pre-check a service before paying it — the mirror of
 * /risk-scan/:address, which lets a payee pre-check a payer. Public and
 * unauthenticated, same as the payer-side scan: this is exactly the kind
 * of check an agent should be able to run before committing to a payment.
 */
payeeReputationRouter.get("/payee-reputation/:address", async (req, res) => {
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

  const reputation = await scorePayee(network, address);
  res.status(200).json(reputation);
});
