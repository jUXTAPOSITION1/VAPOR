import { createApp } from "./api/app.js";
import { config } from "./config/index.js";
import { activeNetworks } from "./config/networks.js";
import { logger } from "./utils/logger.js";
import { retryDueWebhooks } from "./core/webhooks/webhook.service.js";
import { sweepExpiredScanCacheEntries } from "./core/risk/risk-scanner.service.js";
import { sweepSignerBalances } from "./core/signer/signer-balance.service.js";

const app = createApp();

const active = activeNetworks();
if (active.length === 0) {
  logger.warn("no networks are active — set at least one network's RPC URL env var before accepting real traffic");
}

app.listen(config.port, () => {
  logger.info(
    { port: config.port, networks: active.map((n) => n.caip2) },
    "VAPOR facilitator listening"
  );
});

// Polls the webhook retry queue every 10s — frequent enough that the
// shortest backoff tier (5s) doesn't sit idle for long, cheap enough
// (bounded to 25 rows/tick, no-op query when the queue is empty) to run
// forever alongside the request-serving process. A failed tick (e.g. a
// transient DB hiccup) must never take down the whole retry loop, only
// skip that one tick.
setInterval(() => {
  retryDueWebhooks().catch((err) => {
    logger.error({ err }, "webhook retry tick failed");
  });
}, 10_000);

// Bounds the risk-scan result cache's memory footprint over a long-running
// process's lifetime — an address scanned once and never again would
// otherwise sit in the map forever (see risk-scanner.service.ts).
setInterval(() => {
  sweepExpiredScanCacheEntries();
}, 30_000);

// Checks the settlement signer's gas balance every 5 minutes (one cheap
// eth_getBalance per active network — no need for anything faster) and
// once immediately at boot, so a draining or already-empty wallet shows up
// in logs/metrics before settlement starts failing because of it.
sweepSignerBalances().catch((err) => {
  logger.error({ err }, "initial signer balance check failed");
});
setInterval(() => {
  sweepSignerBalances().catch((err) => {
    logger.error({ err }, "signer balance sweep tick failed");
  });
}, 5 * 60_000);
