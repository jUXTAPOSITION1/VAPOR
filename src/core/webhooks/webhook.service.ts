import { createHmac } from "node:crypto";
import { config } from "../../config/index.js";
import { logger } from "../../utils/logger.js";
import { prisma } from "../../storage/prisma.client.js";
import { webhookDeliveryOutcomesTotal } from "../metrics/metrics.service.js";
import { isSafeWebhookUrl } from "./url-guard.js";

export type WebhookEventType = "payment.verified" | "payment.denied" | "payment.settled" | "payment.settlement_failed";

interface WebhookEvent {
  type: WebhookEventType;
  timestamp: string;
  data: Record<string, unknown>;
}

// Exponential backoff in seconds: 5s, 30s, 2min, 10min, 30min, 1hr — caps
// the total retry window at ~2.5h before a delivery is marked permanently
// failed (it stays in the table for audit/export, it just stops retrying).
export const BACKOFF_SECONDS = [5, 30, 120, 600, 1800, 3600];
export const MAX_ATTEMPTS = BACKOFF_SECONDS.length;

// Bounds how many due retries one retryDueWebhooks() tick processes, so a
// large backlog (a payee endpoint down for hours) can't monopolize the
// interval and starve newer deliveries from ever getting a turn.
const MAX_PER_TICK = 25;

function sign(payload: string): string | undefined {
  if (!config.webhookSigningSecret) return undefined;
  return createHmac("sha256", config.webhookSigningSecret).update(payload).digest("hex");
}

type DeliveryResult = { ok: true } | { ok: false; error: string };

async function attemptDelivery(url: string, payload: string, signature: string | undefined): Promise<DeliveryResult> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(signature ? { "x-vapor-signature": signature } : {}),
      },
      body: payload,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function nextAttemptDelay(attemptsSoFar: number): number {
  const idx = Math.min(attemptsSoFar, BACKOFF_SECONDS.length) - 1;
  return BACKOFF_SECONDS[idx] ?? BACKOFF_SECONDS[BACKOFF_SECONDS.length - 1] ?? 3600;
}

/**
 * Webhook delivery to a payee's own endpoint (opted into per-request via
 * `paymentRequirements.extra.webhookUrl`). Never awaited by callers on the
 * request's critical path — a slow or failing payee endpoint must never
 * slow down or fail the payment path itself.
 *
 * The first attempt fires immediately, same as before. Only on failure is
 * anything persisted — retryDueWebhooks() then keeps retrying with
 * exponential backoff (see BACKOFF_SECONDS) until it succeeds or
 * MAX_ATTEMPTS is reached, surviving process restarts since the queue
 * lives in the database, not memory.
 *
 * Signed with HMAC-SHA256 over the raw JSON body when a signing secret is
 * configured, so a payee can verify the event actually came from VAPOR —
 * every retry reuses the exact same signed payload, not a re-signed one.
 *
 * The URL is checked against isSafeWebhookUrl() before every single fetch —
 * see url-guard.ts — since it comes straight from a request body an
 * unauthenticated caller controls (`paymentRequirements.extra.webhookUrl`)
 * and would otherwise be a direct SSRF vector into VAPOR's own network.
 */
export function dispatchWebhook(
  url: string | undefined,
  event: WebhookEventType,
  data: Record<string, unknown>
): void {
  if (!url) return;

  const body: WebhookEvent = { type: event, timestamp: new Date().toISOString(), data };
  const payload = JSON.stringify(body);
  const signature = sign(payload);

  (async () => {
    if (!(await isSafeWebhookUrl(url))) {
      logger.warn({ url, event }, "webhook URL rejected: resolves to a disallowed (private/internal) address");
      webhookDeliveryOutcomesTotal.inc({ outcome: "rejected_unsafe_url" });
      return;
    }

    const result = await attemptDelivery(url, payload, signature);
    if (result.ok) {
      webhookDeliveryOutcomesTotal.inc({ outcome: "delivered_first_attempt" });
      return;
    }
    webhookDeliveryOutcomesTotal.inc({ outcome: "queued_for_retry" });
    logger.warn({ url, event, error: result.error }, "webhook delivery failed, queuing for retry");
    try {
      await prisma.webhookDelivery.create({
        data: {
          url,
          eventType: event,
          payload,
          signature,
          status: "pending",
          attempts: 1,
          nextAttemptAt: new Date(Date.now() + nextAttemptDelay(1) * 1000),
          lastError: result.error,
        },
      });
    } catch (err) {
      logger.error({ err }, "failed to persist webhook retry record — this delivery will not be retried");
    }
  })();
}

/**
 * Scans for due retries and attempts redelivery. Meant to be called on an
 * interval from the server bootstrap (see server.ts) — a plain DB-polled
 * queue, deliberately not a separate queue service, matching VAPOR's
 * existing "just Prisma/SQLite, no extra infra" stack.
 */
export async function retryDueWebhooks(): Promise<void> {
  const due = await prisma.webhookDelivery.findMany({
    where: { status: "pending", nextAttemptAt: { lte: new Date() } },
    take: MAX_PER_TICK,
  });

  for (const delivery of due) {
    // Re-checked on every retry, not just at first enqueue — DNS can change
    // between attempts (see url-guard.ts's docstring on the residual
    // rebinding window this bounds but doesn't fully close).
    if (!(await isSafeWebhookUrl(delivery.url))) {
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: { status: "failed", lastError: "webhook URL resolves to a disallowed (private/internal) address" },
      });
      webhookDeliveryOutcomesTotal.inc({ outcome: "rejected_unsafe_url" });
      logger.warn({ url: delivery.url, id: delivery.id }, "webhook retry aborted: URL now resolves to a disallowed address");
      continue;
    }

    const result = await attemptDelivery(delivery.url, delivery.payload, delivery.signature ?? undefined);

    if (result.ok) {
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: { status: "delivered", deliveredAt: new Date() },
      });
      webhookDeliveryOutcomesTotal.inc({ outcome: "delivered_after_retry" });
      continue;
    }

    const attempts = delivery.attempts + 1;
    const exhausted = attempts >= MAX_ATTEMPTS;
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        attempts,
        lastError: result.error,
        status: exhausted ? "failed" : "pending",
        nextAttemptAt: exhausted ? delivery.nextAttemptAt : new Date(Date.now() + nextAttemptDelay(attempts) * 1000),
      },
    });

    if (exhausted) {
      webhookDeliveryOutcomesTotal.inc({ outcome: "permanently_failed" });
      logger.warn(
        { url: delivery.url, event: delivery.eventType, id: delivery.id, error: result.error },
        "webhook delivery permanently failed after max attempts"
      );
    }
  }
}

export function webhookUrlFromExtra(extra: Record<string, unknown> | undefined): string | undefined {
  const url = extra?.["webhookUrl"];
  return typeof url === "string" && url.length > 0 ? url : undefined;
}
