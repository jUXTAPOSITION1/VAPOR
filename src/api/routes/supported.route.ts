import { Router } from "express";
import type { SupportedResponse } from "../../types/x402.js";
import { activeNetworks } from "../../config/networks.js";

export const supportedRouter = Router();

// The x402 protocol version these payment kinds speak — matches the
// "exact"-over-EIP-3009 PaymentPayload/PaymentRequirements shapes this
// facilitator already verifies and settles (see discovery.service.ts's
// own constant). Per-kind `x402Version` is a REQUIRED field in the
// official x402 client SDK's response schema (@x402/core's
// supportedKindSchema), and @x402/core's resource-server layer indexes
// every facilitator's /supported kinds by this exact number and looks
// them up again by its own internal protocol-version constant
// (currently 2, per @x402/core >=2.18) — a stale value here isn't just
// incomplete, it makes that lookup miss for EVERY route and throws
// RouteConfigurationError for any client on the current SDK, even
// though verify/settle themselves work fine.
const X402_VERSION = 2;

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
