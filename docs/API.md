# VAPOR API Reference

All request/response bodies are JSON. All addresses are checksummed or lowercase 20-byte hex; amounts are base-10 integer strings in the token's smallest unit (e.g. USDC has 6 decimals, so `"1000000"` is 1.00 USDC).

## POST /verify

Verifies a payment payload against a set of payment requirements without moving funds.

**Request**

```json
{
  "x402Version": 1,
  "paymentPayload": {
    "x402Version": 1,
    "scheme": "exact",
    "network": "eip155:8453",
    "payload": {
      "signature": "0x...",
      "authorization": {
        "from": "0x...",
        "to": "0x...",
        "value": "1000000",
        "validAfter": "1700000000",
        "validBefore": "1700003600",
        "nonce": "0x..."
      }
    }
  },
  "paymentRequirements": {
    "scheme": "exact",
    "network": "eip155:8453",
    "maxAmountRequired": "1000000",
    "resource": "https://example.com/paid-endpoint",
    "payTo": "0x...",
    "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "extra": {
      "policy": {
        "maxRiskScore": 60,
        "maxAmountUsd": 50,
        "denyList": []
      },
      "webhookUrl": "https://example.com/webhooks/vapor"
    }
  }
}
```

**Response**

```json
{
  "isValid": true,
  "payer": "0x...",
  "riskAssessment": {
    "score": 10,
    "band": "medium",
    "reasons": ["address has very few prior transactions (2)"],
    "checkedAt": "2026-07-13T22:00:00.000Z"
  }
}
```

`isValid: false` is returned both for payments that fail cryptographic/financial checks (bad signature, insufficient balance, reused nonce) and for payments that fail the payee's own risk policy — check `invalidReason` to distinguish the two; `riskAssessment` is present on policy-driven denials so the payee can see exactly why.

## POST /settle

Same request shape as `/verify`. Re-runs the full verification pipeline against current chain state immediately before broadcasting — a stale or replayed `/settle` call cannot slip through on an earlier `/verify` result.

**Response**

```json
{
  "success": true,
  "payer": "0x...",
  "transaction": "0x...",
  "network": "eip155:8453",
  "amount": "1000000"
}
```

## POST /verify-batch / POST /settle-batch

Convenience wrappers for verifying/settling several **independent** "exact"-scheme payments in one call, capped at 10 entries. This is not the real on-chain escrow/voucher `batch-settlement` scheme from the x402 spec (a different, stateful, `x402Version: 2` protocol with payment channels) — each entry here is a completely ordinary, standalone signed EIP-3009 authorization; VAPOR just processes several of them per request instead of one round trip each.

**Request**

```json
{
  "x402Version": 1,
  "payments": [
    { "paymentPayload": { "...": "..." }, "paymentRequirements": { "...": "..." } },
    { "paymentPayload": { "...": "..." }, "paymentRequirements": { "...": "..." } }
  ]
}
```

**Response**

```json
{ "results": [ { "isValid": true, "...": "..." }, { "isValid": false, "...": "..." } ] }
```

`/verify-batch` runs all entries in parallel (read-only). `/settle-batch` runs entries **sequentially** — every settlement broadcasts from VAPOR's one settlement-signer wallet, and concurrent broadcasts would race on nonce assignment. One entry failing never stops the rest; each gets its own result in `results`, in request order.

## GET /supported

```json
{ "kinds": [{ "scheme": "exact", "network": "eip155:8453" }] }
```

Only networks with both an RPC URL configured and a verified token entry in `src/config/networks.ts` appear here.

## GET /stats

Public, unauthenticated, platform-wide aggregates — no payee or payer addresses, safe to expose to a public dashboard. Cached for 5 seconds server-side.

```json
{
  "generatedAt": "2026-07-14T04:21:15.000Z",
  "uptimeSeconds": 3600,
  "networks": ["eip155:8453"],
  "totals": {
    "verifyRequests": 128,
    "settleRequests": 95,
    "validVerifyCount": 120,
    "settledCount": 90,
    "settledVolumeRaw": "95000000",
    "settledVolumeUsd": 95
  },
  "averageRiskScore": 14.2,
  "riskBandCounts": { "low": 100, "medium": 20, "high": 5 }
}
```

## GET /stats/timeseries?hours=48

Real hourly activity buckets derived from stored request timestamps (max 720 hours / 30 days; invalid or out-of-range values fall back to 48). Cached for 30 seconds server-side.

```json
{
  "hours": 48,
  "points": [
    { "bucket": "2026-07-14T03:00:00Z", "verifyCount": 12, "settleCount": 9, "settledVolumeUsd": 9.5 }
  ]
}
```

## GET /risk-scan/:address?network=eip155:8453

Runs the risk scanner outside of a payment flow — useful for pre-screening at signup or quote time.

```json
{
  "address": "0x...",
  "network": "eip155:8453",
  "riskAssessment": { "score": 0, "band": "low", "reasons": [], "checkedAt": "..." }
}
```

## GET /payee-reputation/:address?network=eip155:8453&agentId=

The mirror of `/risk-scan`: lets a *payer* pre-check a service/payee before paying it, scored positively (established/clean) rather than as risk. Built entirely from VAPOR's own real settlement history for that address plus the same on-chain and reputation-provider signals `/risk-scan` uses — nothing here is guessed or seeded.

`agentId` is optional and opt-in: if supplied, VAPOR looks up that [ERC-8004](https://github.com/erc-8004/erc-8004-contracts) agent's on-chain claimed wallet and only trusts/reports the enrichment if it actually matches `:address`. An address with no supplied `agentId` gets no `erc8004` field at all — VAPOR never reverse-looks-up or guesses an agentId on its own (no such lookup exists on-chain).

```json
{
  "payTo": "0x...",
  "score": 65,
  "band": "established",
  "history": {
    "totalVerifyRequests": 40,
    "totalSettlements": 38,
    "settlementSuccessRate": 0.95,
    "totalSettledVolumeUsd": 12.4,
    "firstSeenAt": "2026-05-01T00:00:00.000Z"
  },
  "flaggedByReputationProvider": false,
  "reasons": ["has 38 completed settlement(s)", "active for 30+ days"],
  "checkedAt": "...",
  "erc8004": { "agentId": "42", "verified": true, "feedbackCount": 12, "averageScore": 0.8 }
}
```

## GET /analytics/:payTo

Requires header `x-api-key: <one of API_KEYS>` when `API_KEYS` is configured.

```json
{
  "payTo": "0x...",
  "totalRequests": 128,
  "validCount": 120,
  "settledCount": 95,
  "totalSettledVolume": "95000000",
  "averageRiskScore": 14.2,
  "riskBandCounts": { "low": 100, "medium": 15, "high": 5 }
}
```

## GET /analytics/:payTo/export?format=json|csv&from=&to=

Full audit-log export for the given payee, optionally bounded by `createdAt`. Same auth as above.

## GET /metrics

Requires header `x-api-key: <one of API_KEYS>` when `API_KEYS` is configured — same gate as `/analytics`, since this is operational detail for VAPOR's own operator, unlike the deliberately-public `/stats`.

Prometheus text-exposition format (`text/plain; version=0.0.4`), scrape-ready as-is. Includes standard Node.js process metrics (CPU, memory, event loop lag, GC) via `prom-client`'s `collectDefaultMetrics`, plus VAPOR-specific instruments:

| Metric | Type | Labels | What it tracks |
|---|---|---|---|
| `vapor_http_request_duration_seconds` | histogram | `method`, `route`, `status_code` | Per-route request latency. `route` is the matched Express route template (e.g. `/analytics/:payTo`), never the raw path, so address/id values never blow up label cardinality. |
| `vapor_http_requests_total` | counter | `method`, `route`, `status_code` | Per-route request counts. |
| `vapor_verify_outcomes_total` | counter | `valid` | `/verify` and `/verify-batch` decisions. |
| `vapor_settle_outcomes_total` | counter | `success` | `/settle` and `/settle-batch` decisions. |
| `vapor_risk_score` | histogram | — | Distribution of every computed payer risk score (0-100), across all callers of the risk scanner (`/verify`, `/settle`, `/risk-scan/:address`). |
| `vapor_webhook_delivery_outcomes_total` | counter | `outcome` | `delivered_first_attempt` / `queued_for_retry` / `delivered_after_retry` / `permanently_failed` / `rejected_unsafe_url`. |

## Per-payee policy overrides (`paymentRequirements.extra.policy`)

| Field | Default | Meaning |
|---|---|---|
| `maxRiskScore` | `DEFAULT_MAX_RISK_SCORE` | Deny if the risk score exceeds this |
| `maxAmountUsd` | `DEFAULT_MAX_AMOUNT_USD` | Deny if the payment amount (USDC, 1:1 USD) exceeds this |
| `minAmountUsd` | none | Deny if the payment amount is below this |
| `denyList` | `[]` | Addresses to always reject regardless of risk score |

## Webhooks (`paymentRequirements.extra.webhookUrl`)

VAPOR POSTs a JSON body to the given URL on each decision:

```json
{ "type": "payment.verified", "timestamp": "...", "data": { "paymentRequirements": {...}, "result": {...} } }
```

Event types: `payment.verified`, `payment.denied`, `payment.settled`, `payment.settlement_failed`.

If `WEBHOOK_SIGNING_SECRET` is configured, each delivery includes an `x-vapor-signature` header: `HMAC-SHA256(secret, rawBody)`, hex-encoded. Delivery is fire-and-forget with a 5-second timeout — a slow or failing endpoint never blocks the payment path.

**URL safety.** `webhookUrl` comes from an unauthenticated request body, so every delivery attempt (the first try and every retry) requires `https://` and resolves the hostname to reject any address that's loopback, link-local, private-range, or the cloud metadata address (`169.254.169.254`) — a URL that resolves to a disallowed address is never fetched at all, and a previously-accepted URL that starts resolving to one (e.g. via DNS rebinding) is caught on its next retry and marked `failed` immediately rather than retried further.

**Retries.** A first-attempt failure is queued and retried with exponential backoff (5s, 30s, 2min, 10min, 30min, 1hr — six attempts total, ~2.5h worst case) until it succeeds or is marked permanently failed. The queue is backed by the database, not memory, so it survives a process restart. Every retry resends the exact same signed payload from the first attempt, never a re-signed one. Aggregate delivery health (`pending`/`delivered`/`failed` counts) is exposed at `GET /stats` under `webhookDeliveries`; a delivery that succeeds on its first attempt is never persisted, so this only reflects deliveries that needed at least one retry.
