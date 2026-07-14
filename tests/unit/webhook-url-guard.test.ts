import { describe, expect, it } from "vitest";
import { isPrivateOrReservedIp, isSafeWebhookUrl } from "../../src/core/webhooks/url-guard.js";

describe("isPrivateOrReservedIp", () => {
  it("flags loopback, private, link-local, and the cloud metadata address", () => {
    expect(isPrivateOrReservedIp("127.0.0.1")).toBe(true);
    expect(isPrivateOrReservedIp("10.1.2.3")).toBe(true);
    expect(isPrivateOrReservedIp("172.16.0.1")).toBe(true);
    expect(isPrivateOrReservedIp("172.31.255.255")).toBe(true);
    expect(isPrivateOrReservedIp("192.168.1.1")).toBe(true);
    expect(isPrivateOrReservedIp("169.254.169.254")).toBe(true);
    expect(isPrivateOrReservedIp("0.0.0.0")).toBe(true);
  });

  it("does not flag public IPv4 addresses, including the 172.x range boundary", () => {
    expect(isPrivateOrReservedIp("8.8.8.8")).toBe(false);
    expect(isPrivateOrReservedIp("1.1.1.1")).toBe(false);
    expect(isPrivateOrReservedIp("172.15.255.255")).toBe(false);
    expect(isPrivateOrReservedIp("172.32.0.0")).toBe(false);
  });

  it("flags IPv6 loopback, link-local, and unique-local addresses", () => {
    expect(isPrivateOrReservedIp("::1")).toBe(true);
    expect(isPrivateOrReservedIp("fe80::1")).toBe(true);
    expect(isPrivateOrReservedIp("fc00::1")).toBe(true);
    expect(isPrivateOrReservedIp("fd12:3456::1")).toBe(true);
  });

  it("does not flag a public IPv6 address", () => {
    expect(isPrivateOrReservedIp("2606:4700:4700::1111")).toBe(false);
  });

  it("resolves an IPv4-mapped IPv6 address to the embedded v4 check", () => {
    expect(isPrivateOrReservedIp("::ffff:169.254.169.254")).toBe(true);
    expect(isPrivateOrReservedIp("::ffff:8.8.8.8")).toBe(false);
  });

  it("fails closed on an unparseable value", () => {
    expect(isPrivateOrReservedIp("not-an-ip")).toBe(true);
  });
});

describe("isSafeWebhookUrl", () => {
  it("rejects non-https schemes", async () => {
    expect(await isSafeWebhookUrl("http://8.8.8.8/hook")).toBe(false);
    expect(await isSafeWebhookUrl("ftp://8.8.8.8/hook")).toBe(false);
  });

  it("rejects a malformed URL", async () => {
    expect(await isSafeWebhookUrl("not a url")).toBe(false);
  });

  it("rejects localhost outright", async () => {
    expect(await isSafeWebhookUrl("https://localhost/hook")).toBe(false);
  });

  it("rejects an https URL whose hostname is a direct private IP literal", async () => {
    expect(await isSafeWebhookUrl("https://169.254.169.254/latest/meta-data")).toBe(false);
    expect(await isSafeWebhookUrl("https://127.0.0.1/hook")).toBe(false);
    expect(await isSafeWebhookUrl("https://10.0.0.5/hook")).toBe(false);
  });

  it("accepts an https URL whose hostname is a direct public IP literal", async () => {
    expect(await isSafeWebhookUrl("https://8.8.8.8/hook")).toBe(true);
  });
});
