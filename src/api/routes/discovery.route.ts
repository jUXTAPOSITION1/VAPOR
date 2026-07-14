import { Router } from "express";
import { registerResource, listResources, searchResources, RegistrationError } from "../../core/discovery/discovery.service.js";
import { registerResourceSchema, listDiscoveryResourcesQuerySchema, searchDiscoveryResourcesQuerySchema } from "../schemas/discovery.schemas.js";
import { validateBody } from "../middleware/validate.middleware.js";
import { requireApiKey } from "../middleware/auth.middleware.js";
import { discoveryRateLimit } from "../middleware/rate-limit.middleware.js";

export const discoveryRouter = Router();

// /discovery/register writes a listing attributable to one payTo, so it's
// gated the same way /analytics/:payTo is — see auth.middleware.ts.
// /discovery/resources[/search] are the actual Bazaar-client-facing reads
// and must stay open, same reasoning as /verify and /settle.
discoveryRouter.use("/discovery/register", requireApiKey);
discoveryRouter.use("/discovery/resources", discoveryRateLimit);

/**
 * Registers (or refreshes) a resource server's own x402 Bazaar discovery
 * listing with VAPOR directly. This is VAPOR's answer to
 * x402-foundation/x402#2112 — rather than relying on an undocumented,
 * observably-broken traffic-sniffing mechanism another facilitator uses,
 * a resource server calls this explicitly and gets a definite result back.
 */
discoveryRouter.post("/discovery/register", validateBody(registerResourceSchema), async (req, res) => {
  try {
    const listing = await registerResource(req.body, res.locals.apiKeyScope?.payTo);
    res.status(200).json(listing);
  } catch (e) {
    if (e instanceof RegistrationError) {
      res.status(403).json({ error: e.message });
      return;
    }
    throw e;
  }
});

discoveryRouter.get("/discovery/resources", async (req, res) => {
  const parsed = listDiscoveryResourcesQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid query parameters", details: parsed.error.flatten() });
    return;
  }
  res.status(200).json(await listResources(parsed.data));
});

discoveryRouter.get("/discovery/resources/search", async (req, res) => {
  const parsed = searchDiscoveryResourcesQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid query parameters", details: parsed.error.flatten() });
    return;
  }
  res.status(200).json(await searchResources(parsed.data));
});
