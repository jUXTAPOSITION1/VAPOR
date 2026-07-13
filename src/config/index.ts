import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3402),
  NODE_ENV: z.enum(["development", "production", "test"]).default("production"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  // Intentionally optional at the schema level — a facilitator with no
  // funded signer can still run /verify and /risk-scan; only /settle needs
  // it. Checked explicitly (and only) inside the settlement service.
  SETTLEMENT_SIGNER_PRIVATE_KEY: z.string().optional(),

  REPUTATION_PROVIDER_BASE_URL: z.string().url().optional().or(z.literal("")),
  REPUTATION_PROVIDER_API_KEY: z.string().optional(),

  DEFAULT_MAX_RISK_SCORE: z.coerce.number().int().min(0).max(100).default(70),
  DEFAULT_MAX_AMOUNT_USD: z.coerce.number().positive().default(1000),

  WEBHOOK_SIGNING_SECRET: z.string().optional(),
  API_KEYS: z.string().optional(),
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
  settlementSignerPrivateKey: env.SETTLEMENT_SIGNER_PRIVATE_KEY as `0x${string}` | undefined,
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
} as const;
