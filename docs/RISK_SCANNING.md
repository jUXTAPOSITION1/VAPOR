# Risk Scanning

VAPOR scores every payer address before a policy decision is made. The scoring function (`src/utils/risk-score.ts`) is pure and deterministic — no I/O, fully unit-tested, and documented here in full so a payee can reason about exactly what a score means rather than trusting an opaque number.

## Signals

### On-chain (always available, no external dependency)

Sourced directly from the configured RPC endpoint via standard JSON-RPC calls — works against any EVM chain, requires no third-party service:

- **Transaction count** (`eth_getTransactionCount`) — the strongest signal available with zero external dependencies. A wallet with zero prior transactions is the dominant shape of both a disposable/scam wallet *and* a brand-new legitimate one. This is a real, inherent limitation of on-chain-only scoring — it's exactly why VAPOR surfaces a score for the payee's own policy to threshold against, rather than an automatic block it decides unilaterally.
- **Contract vs. externally-owned account** (`eth_getCode`) — informational only, not penalized. Smart-contract wallets are an increasingly normal way to pay, not inherently suspicious.

### Reputation intelligence (optional, additive)

If `REPUTATION_PROVIDER_BASE_URL` is configured, VAPOR queries it for a flagged/categories signal via its own small, stable HTTP contract:

```
GET {REPUTATION_PROVIDER_BASE_URL}/{address}?chain_id={chainId}
-> { "flagged": boolean, "categories": string[] }
```

This means VAPOR is never coupled to a specific vendor's schema — point it at any service (managed, in-house, or a thin adapter) that speaks this contract. Unset, VAPOR simply runs on on-chain heuristics alone. Any failure (timeout, non-200, malformed response) is treated as "no signal" — it degrades the assessment to on-chain-only, never invents a false clean or false flagged result by guessing.

## Scoring

| Signal | Weight |
|---|---|
| Flagged by reputation provider | +60 |
| Zero prior transactions | +25 |
| 1–2 prior transactions | +10 |
| Contract address | 0 (informational only) |

Score is capped at 100. Bands: `low` (0–24), `medium` (25–49), `high` (50–74), `severe` (75–100).

The reputation flag dominates but is still additive, not the sole determinant — an unflagged-but-brand-new wallet still registers as elevated risk on transaction history alone.

## Policy, not verdict

VAPOR's risk scanner never unilaterally blocks a payment. A payment that fails signature, replay, or balance checks is invalid outright. A payment that passes all of those but fails a payee's configured risk policy (`paymentRequirements.extra.policy`) is reported as denied *by that policy*, with the full risk assessment attached — the payee's own rules, evaluated against VAPOR's scan, made the call.
