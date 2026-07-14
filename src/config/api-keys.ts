import { getAddress, isAddress } from "viem";

/**
 * A configured API key plus its optional scope. No `payTo` means the key is
 * unscoped — it behaves exactly like a flat pre-scoping key (can query any
 * payTo's analytics/audit export, and is the only kind of key /metrics
 * accepts, since that endpoint is facility-wide operator data rather than
 * anything belonging to one payee). No `expiresAt` means the key never
 * expires.
 */
export interface ApiKeyEntry {
  key: string;
  payTo?: `0x${string}`;
  expiresAt?: Date;
}

/**
 * Each comma-separated API_KEYS entry is `key`, `key|payTo`, `key||expiresAt`,
 * or `key|payTo|expiresAt` — pipe-delimited (not colon) because an ISO-8601
 * timestamp's own colons would otherwise collide with a colon delimiter.
 * Scoping is opt-in per key so existing flat `API_KEYS=a,b,c` deployments
 * keep working unchanged (every key stays unscoped).
 *
 * Fails loudly at boot on a malformed payTo or expiresAt (same "reject now,
 * not on first mismatched request" reasoning as the rest of config/index.ts)
 * rather than silently treating a typo'd scope as "unscoped".
 */
export function parseApiKeys(raw: string): ApiKeyEntry[] {
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const parts = entry.split("|").map((part) => part.trim());
      const [keyRaw, payToRaw, expiresAtRaw] = [parts[0] ?? "", parts[1], parts[2]];
      const parsed: ApiKeyEntry = { key: keyRaw };

      if (payToRaw) {
        if (!isAddress(payToRaw)) {
          console.error(`Invalid API_KEYS entry: "${payToRaw}" is not a valid payTo address`);
          process.exit(1);
          return parsed; // unreachable in production; keeps control flow well-typed when process.exit is mocked in tests
        }
        parsed.payTo = getAddress(payToRaw);
      }

      if (expiresAtRaw) {
        const expiresAt = new Date(expiresAtRaw);
        if (Number.isNaN(expiresAt.getTime())) {
          console.error(`Invalid API_KEYS entry: "${expiresAtRaw}" is not a valid expiresAt date`);
          process.exit(1);
          return parsed; // unreachable in production; keeps control flow well-typed when process.exit is mocked in tests
        }
        parsed.expiresAt = expiresAt;
      }

      return parsed;
    });
}
