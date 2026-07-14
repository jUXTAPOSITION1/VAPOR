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

## GET /risk-scan/:address?network=eip155:8453

Runs the risk scanner outside of a payment flow — useful for pre-screening at signup or quote time.

```json
{
  "address": "0x...",
  "network": "eip155:8453",
  "riskAssessment": { "score": 0, "band": "low", "reasons": [], "checkedAt": "..." }
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
