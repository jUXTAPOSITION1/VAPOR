import { afterEach, describe, expect, it } from "vitest";
import { buildTransport, resolveRpcUrls } from "../../src/blockchain/clients/chain.client.js";
import type { NetworkConfig } from "../../src/config/networks.js";

const FAKE_NETWORK = { rpcEnvVar: "TEST_RPC_URL" } as NetworkConfig;

describe("resolveRpcUrls", () => {
  afterEach(() => {
    delete process.env.TEST_RPC_URL;
  });

  it("returns an empty array when the env var is unset", () => {
    expect(resolveRpcUrls(FAKE_NETWORK)).toEqual([]);
  });

  it("returns a single-element array for one URL", () => {
    process.env.TEST_RPC_URL = "https://primary.example";
    expect(resolveRpcUrls(FAKE_NETWORK)).toEqual(["https://primary.example"]);
  });

  it("splits, trims, and drops empty entries from a comma-separated list", () => {
    process.env.TEST_RPC_URL = " https://primary.example ,https://backup.example,,";
    expect(resolveRpcUrls(FAKE_NETWORK)).toEqual(["https://primary.example", "https://backup.example"]);
  });
});

describe("buildTransport", () => {
  it("builds a plain http transport for a single URL", () => {
    const transport = buildTransport(["https://primary.example"]);
    expect(transport({}).config.type).toBe("http");
  });

  it("builds a fallback transport (strict priority order, ranking off) for multiple URLs", () => {
    const transport = buildTransport(["https://primary.example", "https://backup.example"]);
    const instance = transport({});
    expect(instance.config.type).toBe("fallback");
    expect(instance.value?.transports).toHaveLength(2);
  });
});
