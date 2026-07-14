# VAPOR

**V.A.P.E. Agent Payment Orchestrator & Relayer**

[![CI](https://github.com/jUXTAPOSITION1/VAPOR/actions/workflows/ci.yml/badge.svg)](https://github.com/jUXTAPOSITION1/VAPOR/actions/workflows/ci.yml)
[![Deploy to Oracle Cloud](https://github.com/jUXTAPOSITION1/VAPOR/actions/workflows/deploy-oracle.yml/badge.svg)](https://github.com/jUXTAPOSITION1/VAPOR/actions/workflows/deploy-oracle.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-A1A1AA?style=flat-square)](LICENSE)
![Base](https://img.shields.io/badge/Chain-Base-0052FF?style=flat-square&logo=coinbase&logoColor=white)
![x402](https://img.shields.io/badge/Protocol-x402-22D3EE?style=flat-square)
![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?style=flat-square&logo=typescript&logoColor=white)

VAPOR is an x402 facilitator: it verifies and settles stablecoin payments authorized via [EIP-3009](https://eips.ethereum.org/EIPS/eip-3009) (`transferWithAuthorization`), the same "exact" payment scheme the x402 protocol is built around. Any resource server or AI agent that already speaks x402 can point at VAPOR with zero protocol changes.

What VAPOR adds on top of a standard facilitator is a **risk-scanning layer built into the payment path itself** — every payer is assessed before a payee's policy decides whether to accept the payment, not after the money has already moved. No facilitator fees. No lock-in. Built for machine-speed, agent-to-agent commerce.

**Live dashboard:** [juxtaposition1.github.io/VAPOR](https://juxtaposition1.github.io/VAPOR/) · **API:** `https://x402.duckdns.org`

## Why VAPOR

Payment verification and settlement are table stakes — any facilitator does that. The question that matters for autonomous, agent-driven commerce is: **who, exactly, is paying?** An AI agent buying an API call from another AI agent has no human in the loop to eyeball a suspicious wallet before the transaction clears. VAPOR treats that as the core problem to solve, not an afterthought:

- **Payer Risk Scanner** — every payment is scored *before* settlement, combining live on-chain signals (wallet age, transaction history, contract-vs-EOA) with an optional external reputation signal, through a deterministic, fully-documented scoring function. No black box, no vendor lock-in: point `REPUTATION_PROVIDER_BASE_URL` at any service that speaks VAPOR's own small HTTP contract, or run on-chain signals alone.
- **Configurable Risk Policies** — every payee sets their own bar: max risk score, min/max payment amounts, and a deny list, carried per-request in the x402 `paymentRequirements.extra` field. VAPOR never makes a unilateral accept/reject call on a payee's behalf — it scores, the payee's own policy decides.
- **Audit-Grade Logging & Export** — every `/verify` and `/settle` call is written to an append-only, hash-chained audit log: what was checked, what was decided, and why — tampering with a past entry is detectable, not just access-controlled against. Exportable as JSON or CSV per payee, per date range.
- **Payee Analytics** — aggregate view per payee: request volume, settlement volume, average risk score, risk-band breakdown — the operational visibility a facilitator should hand you by default.
- **Webhook Event System** — real-time, HMAC-signed delivery of `payment.verified`, `payment.denied`, `payment.settled`, and `payment.settlement_failed` events to a payee's own endpoint, backed by a persisted retry queue so a payee's temporary outage never silently drops events.
- **Payee Reputation (the mirror)** — `GET /payee-reputation/:address` scores a *service*, not just a payer, with an opt-in ERC-8004 on-chain reputation enrichment.
- **Multi-Chain Ready** — network and token configuration is data-driven (`src/config/networks.ts`); adding a chain means adding a verified entry, not rewriting the verification or settlement pipeline.
- **x402 Bazaar-compatible discovery** — VAPOR is a discoverable facilitator in its own right: `POST /discovery/register` + `GET /discovery/resources[/search]` speak the same `DiscoveryResource` wire format a real Bazaar client already expects, via an explicit registration contract rather than another facilitator's undocumented, observably-broken traffic-sniffing one (see [`docs/API.md`](docs/API.md#discovery-x402-bazaar)).
- **Zero facilitator fees.** VAPOR doesn't take a cut of settled payments.

## How it works

```
Resource Server / Agent            VAPOR                              Chain
        │                            │                                  │
        │  POST /verify              │                                  │
        ├───────────────────────────▶│  1. scheme/network/asset match   │
        │                            │  2. time window + amount match   │
        │                            │  3. EIP-712 signature recovery   │
        │                            │  4. authorizationState (replay)  │
        │                            │  5. balanceOf (funds check)  ────▶│
        │                            │◀──────────────────────────────── │
        │                            │  6. risk scan (on-chain + intel) │
        │                            │  7. policy evaluation            │
        │◀───────────────────────────┤  VerifyResponse + riskAssessment │
        │                            │                                  │
        │  POST /settle              │                                  │
        ├───────────────────────────▶│  re-verify, then                 │
        │                            │  transferWithAuthorization  ────▶│
        │                            │◀──────────────────────────────── │
        │◀───────────────────────────┤  SettleResponse (tx hash)        │
```

Every domain-sensitive value in the EIP-712 signature check (`name`, `version`, `chainId`, `verifyingContract`) comes from VAPOR's own verified network configuration — never from the caller's request. This closes the domain-substitution gap where a facilitator that trusts caller-supplied signing-domain parameters can be tricked into "verifying" a signature against the wrong contract entirely.

Full component breakdown, request-flow diagram, and deployment pipeline: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Quickstart

### Docker

```bash
cp .env.example .env   # fill in BASE_MAINNET_RPC_URL and SETTLEMENT_SIGNER_PRIVATE_KEY
docker compose up --build
```

### Local development

```bash
npm install
cp .env.example .env
npm run prisma:migrate
npm run dev
```

The server listens on `PORT` (default `3402`).

### Production deploy (Oracle Cloud)

Deploys automatically to an Oracle Cloud compute instance on every push to `main` via GitHub Actions (test → container vulnerability scan → SSH + Docker Compose), fronted by Caddy for automatic TLS — see [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) and the pipeline diagram in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#deployment-ok).

## API

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/verify` | POST | none (public x402 handshake) | Verify a payment payload against payment requirements; returns a risk assessment |
| `/settle` | POST | none (public x402 handshake) | Re-verify and broadcast `transferWithAuthorization` on-chain |
| `/verify-batch` | POST | none | Verify up to 10 independent "exact" payments in one call |
| `/settle-batch` | POST | none | Settle up to 10 independent "exact" payments in one call (sequential, real on-chain txs) |
| `/supported` | GET | none | List active `scheme`/`network` combinations |
| `/risk-scan/:address` | GET | none | Score any address on-demand, outside a payment flow |
| `/payee-reputation/:address` | GET | none | Score a payee/service (the mirror of `/risk-scan`); optional `?agentId=` opts into ERC-8004 reputation enrichment |
| `/stats` | GET | none | Public, platform-wide aggregate metrics (powers the live dashboard) |
| `/analytics/:payTo` | GET | API key | Aggregate stats for a payee |
| `/analytics/:payTo/export` | GET | API key | Full audit log export (`?format=json\|csv`) |
| `/metrics` | GET | API key | Prometheus-format operational metrics (latency, verify/settle outcomes, risk score distribution, webhook delivery health) |
| `/discovery/register` | POST | API key | Register/refresh a resource server's x402 Bazaar discovery listing |
| `/discovery/resources` | GET | none | List discoverable resources (Bazaar-client-facing) |
| `/discovery/resources/search` | GET | none | Search discoverable resources by natural-language query |
| `/healthz` | GET | none | Liveness check |

Full request/response shapes: [`docs/API.md`](docs/API.md). Risk-scoring methodology: [`docs/RISK_SCANNING.md`](docs/RISK_SCANNING.md).

## Configuration

See [`.env.example`](.env.example) for the full list. The facilitator fails fast at boot on invalid configuration rather than starting in a half-working state.

## Security model

- Settlement signer key never touches request/response bodies or logs (see `src/utils/logger.ts` redaction rules).
- Signer balance is monitored continuously (`src/core/signer/signer-balance.service.ts`) so a draining hot wallet is caught before it starts silently failing settlements.
- Nonce replay is checked on-chain (`authorizationState`) immediately before settlement, not cached.
- The EIP-712 domain is always derived from VAPOR's own verified per-network config, never from request input.
- The audit log is hash-chained (`src/core/audit/audit-chain.service.ts`) — a past entry can't be silently altered without breaking the chain.
- Operator-facing routes (`/analytics`, `/metrics`) are gated by per-key-scoped API auth; the public x402 handshake routes (`/verify`, `/settle`, `/supported`) need none, by design.
- Audit logging and webhook delivery are best-effort and non-blocking: a failure in either never blocks or fails a payment decision.

## Documentation

| Doc | Covers |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Component breakdown, request-flow diagram, deployment pipeline |
| [`docs/API.md`](docs/API.md) | Full request/response shapes for every endpoint |
| [`docs/RISK_SCANNING.md`](docs/RISK_SCANNING.md) | Signals, weights, caching, and the policy-not-verdict model |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Oracle Cloud + Docker + Caddy production setup |

## License

MIT — see [`LICENSE`](LICENSE).
