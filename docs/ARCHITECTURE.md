# VAPOR Architecture

> Status legend: [OK] implemented & running · [WIP] partial/scaffolded · [TBD] planned

VAPOR is a single, focused service: an **x402 payment facilitator** (verify + settle
EIP-3009 `transferWithAuthorization` payments) with a **payer risk-scanning layer**
built directly into the verification path, not bolted on after the fact. It runs as
one Node/Express process, backed by Postgres (via Prisma) for durable state, deployed
as a Docker container on an Oracle Cloud compute instance behind Caddy (automatic TLS).
No queue, no microservices, no vendor lock-in — a resource server or AI agent that
already speaks x402 points at VAPOR with zero protocol changes.

## Request flow

```
                     Resource Server / AI Agent (buyer + payer)
                                     │
                        POST /verify { paymentPayload, paymentRequirements }
                                     ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                              src/api/app.ts                               │
│   express-rate-limit ──▶ auth (API-key routes only) ──▶ zod validate      │
└───────────────────────────────────────┬───────────────────────────────────┘
                                         ▼
                     src/core/verification/verification.service.ts
                     1. scheme/network/asset match (src/config/networks.ts)
                     2. validity window + amount match
                     3. EIP-712 signature recovery (viem) — domain fields
                        (name/version/chainId/verifyingContract) always come
                        from VAPOR's own verified network config, NEVER from
                        the caller's request (closes the domain-substitution gap)
                     4. authorizationState on-chain replay check
                     5. balanceOf funds check
                                         │
                                         ▼
                     src/core/risk/risk-scanner.service.ts
                     on-chain signals (tx count, wallet-age tier, EOA/contract)
                     + optional reputation provider  ──▶  numeric score + band
                                         │
                                         ▼
                     src/core/policy/policy.engine.ts
                     payee's own paymentRequirements.extra.policy
                     (max risk score, min/max amount, deny list) decides
                     accept/deny — VAPOR never makes that call unilaterally
                                         │
                                         ▼
                     VerifyResponse { isValid, riskAssessment, policyDecision }
                                         │
                              (buyer resubmits) POST /settle
                                         ▼
                     src/core/settlement/settlement.service.ts
                     re-verify, then transferWithAuthorization via
                     src/core/signer (the settlement signer) on
                     src/blockchain/clients/chain.client.ts (viem)
                                         │
                                         ▼
                     src/core/audit/audit-chain.service.ts
                     every /verify + /settle decision appended to a
                     hash-chained, tamper-evident audit log (Postgres,
                     src/storage/repositories/), each entry has an
                     independently exportable JSON/CSV trail
```

Every write path (audit log, webhook delivery, analytics) is designed so a
failure there **never blocks or fails a payment decision** — logging and
notification are always best-effort side effects of a verify/settle call,
not preconditions for one.

## Components

### `src/api/` [OK] — HTTP surface (Express)
- **`app.ts`** — wires middleware and mounts every route below; the only place
  request-handling order is decided.
- **`middleware/`** — `rate-limit.middleware.ts` (per-IP and, where applicable,
  per-API-key throttling via `express-rate-limit`), `auth.middleware.ts`
  (API-key auth + per-key scoping for the operator-facing routes —
  `/analytics`, `/analytics/export`, `/metrics` — never the public x402
  handshake routes), `validate.middleware.ts` (zod schema enforcement from
  `src/api/schemas/`), `error.middleware.ts` (uniform error envelope, never
  leaks internals).
- **`routes/`** — one file per endpoint: `verify`, `verify-batch`, `settle`,
  `settle-batch`, `supported`, `risk-scan`, `payee-reputation`, `stats`,
  `analytics`, `metrics`, `audit`. See [`docs/API.md`](API.md) for full
  request/response shapes.

### `src/core/verification/` [OK]
`verification.service.ts` — the deterministic checks a payment must pass
before risk scoring or settlement ever runs: scheme/network/asset match,
time-window and amount match, EIP-712 signature recovery, on-chain
`authorizationState` (replay), and a `balanceOf` funds check. See the
Security model section of the [README](../README.md) for why the EIP-712
domain is always derived from VAPOR's own config.

### `src/core/risk/` [OK]
`risk-scanner.service.ts` (+ `providers/` for the optional external
reputation call) — every payer is scored *before* a policy decision is made.
Full signal list, weights, and the caching/degradation rules are documented
in [`docs/RISK_SCANNING.md`](RISK_SCANNING.md); nothing here is duplicated
across both places.

### `src/core/policy/` [OK]
`policy.engine.ts` — evaluates a payee's own `paymentRequirements.extra`
policy (max risk score, min/max amount, deny list) against the risk
assessment. VAPOR scores; the payee's own policy decides. A payment that
fails policy is reported as *denied by that policy*, with the full
assessment attached — never silently dropped.

### `src/core/settlement/` [OK]
`settlement.service.ts` — re-verifies, then broadcasts the real
`transferWithAuthorization` call on-chain. Nonce replay is re-checked
on-chain immediately before settlement (never cached), and the settlement
signer key never touches request/response bodies or logs.

### `src/core/reputation/` [OK]
`payee-reputation.service.ts` — the mirror of the payer risk scanner, scoring
a *payee* (service) instead of a payer, with an opt-in ERC-8004 on-chain
reputation enrichment via `src/blockchain/clients/erc8004.client.ts`. Powers
`GET /payee-reputation/:address`.

### `src/core/signer/` [OK]
`signer-balance.service.ts` — monitors the settlement signer's on-chain
native-token balance so a draining hot wallet is caught before it can
silently start failing every settlement, rather than surfacing only as a
wall of failed-transaction errors after the fact.

### `src/core/audit/` [OK]
`audit-chain.service.ts` — every `/verify` and `/settle` decision is
appended to a hash-chained log (each entry commits to the previous one), so
tampering with historical entries is detectable, not just theoretically
prevented by access control. Exportable per-payee as JSON or CSV via
`GET /analytics/:payTo/export`.

### `src/core/webhooks/` [OK]
`webhook.service.ts` (+ `url-guard.ts`, which validates a payee's registered
callback URL against SSRF-style targets before VAPOR ever POSTs to it) —
real-time, HMAC-signed delivery of `payment.verified` / `payment.denied` /
`payment.settled` / `payment.settlement_failed` events, backed by a
persisted retry queue so a payee's temporary outage doesn't drop events.

### `src/core/metrics/` and `src/core/analytics/` [OK]
`metrics.service.ts` exposes Prometheus-format operational metrics (latency,
verify/settle outcomes, risk-score distribution, webhook delivery health) at
`GET /metrics`. `analytics.service.ts` aggregates the audit log into
per-payee request/settlement volume, average risk score, and risk-band
breakdown for `GET /analytics/:payTo` and the public `GET /stats` that
powers the live dashboard.

### `src/blockchain/` [OK]
`abi.ts` (the exact ABIs VAPOR verifies signatures and settles against —
`transferWithAuthorization`, `authorizationState`) and `clients/` —
`chain.client.ts` (viem public/wallet clients per configured network) and
`erc8004.client.ts` (the on-chain reputation-registry read path for the
optional payee-reputation enrichment).

### `src/config/` [OK]
`networks.ts` — the verified, data-driven network/token registry (adding a
chain means adding an entry here, not touching verification or settlement
code). `api-keys.ts` — per-key scoping for the operator-facing routes.
`index.ts` — env-var loading that fails fast at boot on invalid
configuration rather than starting in a half-working state.

### `src/storage/` [OK]
`prisma.client.ts` + `repositories/` (e.g. `payment-record.repository.ts`) —
the only layer that talks to Postgres directly; every service above goes
through a repository, never a raw Prisma call of its own.

## Deployment [OK]

```
push to main
     │
     ▼
.github/workflows/deploy-oracle.yml
     │
     ├─▶ test           (reuses ci.yml: npm ci → npm audit --omit=dev
     │                    --audit-level=high → prisma generate → typecheck
     │                    → vitest → build)
     │
     ├─▶ container-scan  (docker build, then trivy image scan,
     │                    --severity CRITICAL,HIGH --ignore-unfixed,
     │                    fails the deploy on any unfixed finding)
     │
     └─▶ deploy          (needs: [test, container-scan] — rsync repo over
                          SSH to the Oracle Cloud instance, write the
                          server-side .env from repo secrets, then
                          `docker compose up -d --build --remove-orphans`)
                                     │
                                     ▼
                       Caddy (Caddyfile) — automatic TLS,
                       reverse-proxies x402.duckdns.org → the container
                                     │
                                     ▼
                   Live dashboard: juxtaposition1.github.io/VAPOR
                   (docs/index.html, GitHub Pages, reads GET /stats)
```

`ci.yml` also runs standalone on every pull request against `main` (via
`workflow_call`), so the same test gate applies before a change is even
eligible to reach `deploy-oracle.yml`.

## Runtime map

| Runtime | Trigger | State |
|---|---|---|
| API server (`src/server.ts`) | always-on (Docker container, `docker compose up -d`) | Postgres (Prisma) |
| Webhook retry queue | in-process, backed by persisted queue state | Postgres |
| GitHub Actions CI | every PR to `main` | none (stateless test run) |
| GitHub Actions deploy | every push to `main` | remote Oracle instance |

## Current vs. future

**Now:** real EIP-3009/EIP-712 verify + settle on Base mainnet, a payer risk
scanner with on-chain + optional external signals, per-payee configurable
policy, hash-chained audit logging with export, payee analytics, HMAC-signed
webhooks with retry, Prometheus metrics, an opt-in ERC-8004 payee-reputation
mirror, batch verify/settle (up to 10 payments per call), signer balance
monitoring, and per-key API scoping — all gated behind CI + a container
vulnerability scan on every deploy.

**Next:** broader network/token coverage in `src/config/networks.ts` as
real demand appears, and registering/broadcasting VAPOR itself for
discoverability as a facilitator (see the project roadmap).
