import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * SSRF guard for payee-supplied webhook URLs (`paymentRequirements.extra.webhookUrl`).
 * That field is attacker-controlled — it comes straight from the body of an
 * unauthenticated /verify or /settle call — so without this check any caller
 * could make VAPOR's server issue outbound requests to internal addresses
 * (cloud metadata endpoints, services on the deploy host's private network,
 * etc.), with the response body echoing real payment/risk data back to
 * wherever that URL points.
 *
 * Requires https (blocks plaintext and non-http(s) schemes outright), then
 * resolves the hostname and rejects any resolved address that's loopback,
 * link-local (including the 169.254.169.254 cloud metadata address),
 * private-range, or otherwise non-public. Every delivery attempt (first try
 * and every retry — see webhook.service.ts) re-resolves and re-checks, which
 * bounds a DNS-rebinding attack to the narrow window between this lookup and
 * the fetch's own connection on that same attempt, rather than leaving a
 * static bypass once a URL is accepted. It does not close that window
 * entirely — a fully rebinding-proof fetch would need to pin the connection
 * to the address this function already validated, which webhook.service.ts's
 * plain `fetch()` does not do.
 */
export async function isSafeWebhookUrl(rawUrl: string): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  if (url.protocol !== "https:") return false;
  if (url.hostname.toLowerCase() === "localhost") return false;

  const directIpVersion = isIP(url.hostname);
  if (directIpVersion) {
    return !isPrivateOrReservedIp(url.hostname);
  }

  try {
    const records = await dnsLookup(url.hostname, { all: true, verbatim: true });
    if (records.length === 0) return false;
    return records.every((r) => !isPrivateOrReservedIp(r.address));
  } catch {
    // DNS failure degrades to "unsafe", never to "assume public" — a
    // webhook URL that can't currently be resolved gets no benefit of the
    // doubt.
    return false;
  }
}

export function isPrivateOrReservedIp(ip: string): boolean {
  const version = isIP(ip);

  if (version === 4) {
    const octets = ip.split(".").map(Number);
    const [a, b] = octets;
    if (a === undefined || b === undefined) return true;
    if (a === 127) return true; // loopback
    if (a === 10) return true; // private
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 169 && b === 254) return true; // link-local, incl. 169.254.169.254 cloud metadata
    if (a === 0) return true; // "this network"
    if (a >= 224) return true; // multicast/reserved
    return false;
  }

  if (version === 6) {
    const normalized = ip.toLowerCase();
    if (normalized === "::1") return true; // loopback
    if (normalized === "::") return true; // unspecified
    if (normalized.startsWith("fe80:")) return true; // link-local
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // unique local (fc00::/7)
    if (normalized.startsWith("::ffff:")) {
      // IPv4-mapped IPv6 — validate the embedded v4 address instead.
      const mapped = normalized.slice("::ffff:".length);
      if (isIP(mapped) === 4) return isPrivateOrReservedIp(mapped);
    }
    return false;
  }

  // Not a parseable IP at all — fail closed rather than assume public.
  return true;
}
