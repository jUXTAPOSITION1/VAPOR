import { Router } from "express";
import type { SupportedResponse } from "../../types/x402.js";
import { activeNetworks } from "../../config/networks.js";

export const supportedRouter = Router();

// The x402 protocol version these payment kinds speak — matches the
// "exact"-over-EIP-3009 PaymentPayload/PaymentRequirements shapes this
// facilitator already verifies and settles (see discovery.service.ts's
// same constant). Per-kind `x402Version` is a REQUIRED field in the
// official x402 client SDK's response schema (@x402/core's
// supportedKindSchema) — omitting it isn't just incomplete, it makes
// every x402 client that validates responses against that schema (not
// just Cloudflare-Worker-hosted ones) treat this entire /supported
// response as malformed and silently ignore this facilitator.
const X402_VERSION = 1;

supportedRouter.get("/supported", (_req, res) => {
  const response: SupportedResponse = {
    kinds: activeNetworks().map((network) => ({
      x402Version: X402_VERSION,
      scheme: "exact",
      network: network.caip2,
    })),
  };
  res.status(200).json(response);
});
