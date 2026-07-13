import { createApp } from "./api/app.js";
import { config } from "./config/index.js";
import { activeNetworks } from "./config/networks.js";
import { logger } from "./utils/logger.js";

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
