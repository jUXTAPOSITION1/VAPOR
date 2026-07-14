import { Counter, Histogram, Registry, collectDefaultMetrics } from "prom-client";

/**
 * A dedicated Registry (not the global default one) so tests can spin up
 * multiple app instances without metrics from one leaking into another.
 * `collectDefaultMetrics` adds Node.js process-level metrics (CPU, memory,
 * event loop lag, GC) for free — standard operational visibility any
 * Prometheus setup expects, not VAPOR-specific.
 */
export const registry = new Registry();
collectDefaultMetrics({ register: registry });

export const httpRequestDuration = new Histogram({
  name: "vapor_http_request_duration_seconds",
  help: "HTTP request duration in seconds, by method/route/status",
  labelNames: ["method", "route", "status_code"] as const,
  // Payment-path requests should be fast; buckets skew toward sub-second
  // resolution rather than the client library's coarser defaults.
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export const httpRequestsTotal = new Counter({
  name: "vapor_http_requests_total",
  help: "Total HTTP requests, by method/route/status",
  labelNames: ["method", "route", "status_code"] as const,
  registers: [registry],
});

export const verifyOutcomesTotal = new Counter({
  name: "vapor_verify_outcomes_total",
  help: "Total /verify decisions, by whether the payment was valid",
  labelNames: ["valid"] as const,
  registers: [registry],
});

export const settleOutcomesTotal = new Counter({
  name: "vapor_settle_outcomes_total",
  help: "Total /settle decisions, by whether settlement succeeded",
  labelNames: ["success"] as const,
  registers: [registry],
});

export const riskScoreDistribution = new Histogram({
  name: "vapor_risk_score",
  help: "Distribution of computed payer risk scores (0-100)",
  buckets: [0, 10, 25, 50, 75, 90, 100],
  registers: [registry],
});

export const webhookDeliveryOutcomesTotal = new Counter({
  name: "vapor_webhook_delivery_outcomes_total",
  help: "Total webhook delivery attempts, by outcome",
  labelNames: ["outcome"] as const, // "delivered_first_attempt" | "queued_for_retry" | "delivered_after_retry" | "permanently_failed"
  registers: [registry],
});
