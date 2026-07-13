import { Router } from "express";
import type { SupportedResponse } from "../../types/x402.js";
import { activeNetworks } from "../../config/networks.js";

export const supportedRouter = Router();

supportedRouter.get("/supported", (_req, res) => {
  const response: SupportedResponse = {
    kinds: activeNetworks().map((network) => ({ scheme: "exact", network: network.caip2 })),
  };
  res.status(200).json(response);
});
