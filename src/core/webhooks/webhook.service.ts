import { createHmac } from "node:crypto";
import { config } from "../../config/index.js";
import { logger } from "../../utils/logger.js";

export type WebhookEventType = "payment.verified" | "payment.denied" | "payment.settled" | "payment.settlement_failed";

interface WebhookEvent {
  type: WebhookEventType;
  timestamp: string;
  data: Record<string, unknown>;
}

function sign(payload: string): string | undefined {
  if (!config.webhookSigningSecret) return undefined;
  return createHmac("sha256", config.webhookSigningSecret).update(payload).digest("hex");
}

/**
 * Fire-and-forget webhook delivery to a payee's own endpoint (opted into
 * per-request via `paymentRequirements.extra.webhookUrl`). A slow or
 * failing payee endpoint must never slow down or fail the payment path
 * itself — this is deliberately not awaited by callers on the request's
 * critical path.
 *
 * Signed with HMAC-SHA256 over the raw JSON body when a signing secret is
 * configured, so a payee can verify the event actually came from VAPOR.
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

  fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(signature ? { "x-vapor-signature": signature } : {}),
    },
    body: payload,
    signal: AbortSignal.timeout(5000),
  }).catch((err) => {
    logger.warn({ err, url, event }, "webhook delivery failed");
  });
}

export function webhookUrlFromExtra(extra: Record<string, unknown> | undefined): string | undefined {
  const url = extra?.["webhookUrl"];
  return typeof url === "string" && url.length > 0 ? url : undefined;
}
