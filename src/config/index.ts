import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3402),
  NODE_ENV: z.enum(["development", "production", "test"]).default("production"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  // Intentionally optional at the schema level — a facilitator with no
  // funded signer can still run /verify and /risk-scan; only /settle needs
  // it. But if a value IS provided, it must be a real 32-byte private key —
  // validated here so a malformed key fails loudly at boot, not with an
  // uncaught exception (and a crashed process) on the first /settle call.
  //
  // Preprocessed to tolerate the single most common way to paste this
  // wrong: a raw 64-hex-char key with no "0x" prefix (easy to do when
  // copying straight from a wallet export). Anything else malformed still
  // fails validation below rather than being silently "fixed".
  SETTLEMENT_SIGNER_PRIVATE_KEY: z.preprocess(
    (val) => {
      if (typeof val !== "string" || val === "") return val;
      return /^[0-9a-fA-F]{64}$/.test(val) ? `0x${val}` : val;
    },
    z
      .string()
      .regex(/^0x[0-9a-fA-F]{64}$/, "must be a 0x-prefixed 32-byte (64 hex character) private key")
      .optional()
      .or(z.literal(""))
  ),

  REPUTATION_PROVIDER_BASE_URL: z.string().url().optional().or(z.literal("")),
  REPUTATION_PROVIDER_API_KEY: z.string().optional(),

  DEFAULT_MAX_RISK_SCORE: z.coerce.number().int().min(0).max(100).default(70),
  DEFAULT_MAX_AMOUNT_USD: z.coerce.number().positive().default(1000),

  WEBHOOK_SIGNING_SECRET: z.string().optional(),
  API_KEYS: z.string().optional(),

  // The settlement signer only ever pays gas (transferWithAuthorization
  // moves USDC directly from payer to payee per the payer's own signature,
  // never through this wallet) — but an unnoticed empty gas tank still
  // means settlement silently starts failing. Threshold is in whole ETH
  // (not wei) since it's meant to be hand-tuned per deployment, not
  // computed; 0.01 ETH is comfortably more than one Base transferWithAuthorization
  // costs even during a gas spike, while still catching a draining wallet
  // well before it actually hits zero.
  SIGNER_LOW_BALANCE_ETH: z.coerce.number().nonnegative().default(0.01),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  // /verify, /settle, and their batch siblings are the actual payment path —
  // a real agent may legitimately fire several per minute, so this is looser.
  RATE_LIMIT_MAX_PAYMENT: z.coerce.number().int().positive().default(120),
  // /risk-scan and /payee-reputation are free, unauthenticated, RPC-cost-
  // bearing reads with no payment gating them at all — tighter by default.
  RATE_LIMIT_MAX_SCAN: z.coerce.number().int().positive().default(30),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // Fails loudly and immediately at boot — a misconfigured facilitator
  // that starts anyway and fails on the first real request is worse than
  // one that never starts.
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;

export const config = {
  port: env.PORT,
  nodeEnv: env.NODE_ENV,
  logLevel: env.LOG_LEVEL,
  databaseUrl: env.DATABASE_URL,
  settlementSignerPrivateKey: (env.SETTLEMENT_SIGNER_PRIVATE_KEY || undefined) as `0x${string}` | undefined,
  signerLowBalanceEth: env.SIGNER_LOW_BALANCE_ETH,
  reputationProvider: {
    baseUrl: env.REPUTATION_PROVIDER_BASE_URL || undefined,
    apiKey: env.REPUTATION_PROVIDER_API_KEY,
  },
  policyDefaults: {
    maxRiskScore: env.DEFAULT_MAX_RISK_SCORE,
    maxAmountUsd: env.DEFAULT_MAX_AMOUNT_USD,
  },
  webhookSigningSecret: env.WEBHOOK_SIGNING_SECRET,
  apiKeys: (env.API_KEYS ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean),
  rateLimit: {
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    maxPayment: env.RATE_LIMIT_MAX_PAYMENT,
    maxScan: env.RATE_LIMIT_MAX_SCAN,
  },
} as const;
