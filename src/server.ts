import { createApp } from "./api/app.js";
import { config } from "./config/index.js";
import { activeNetworks } from "./config/networks.js";
import { logger } from "./utils/logger.js";
import { retryDueWebhooks } from "./core/webhooks/webhook.service.js";

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
