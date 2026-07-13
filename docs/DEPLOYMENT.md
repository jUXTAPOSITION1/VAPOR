# Deployment (Fly.io)

VAPOR ships ready to deploy to [Fly.io](https://fly.io) straight from its Dockerfile. Fly no longer offers a fully free tier — this runs comfortably on a single `shared-cpu-1x` / 256MB machine, which is a low, usage-metered cost for the traffic a launch-stage facilitator sees, and scales to zero when idle.

## One-time setup (do this yourself — these are billing-bearing account actions)

1. Create a Fly.io account and install `flyctl`, then `flyctl auth login`.
2. Create the app (name must match `app` in `fly.toml`, or edit `fly.toml` to match yours):
   ```bash
   flyctl apps create vapor-facilitator
   ```
3. Create a persistent volume for the SQLite audit log (matches `fly.toml`'s mount):
   ```bash
   flyctl volumes create vapor_data --region iad --size 1 --app vapor-facilitator
   ```
4. Create a deploy token and add it as a GitHub Actions repo secret named `FLY_API_TOKEN`:
   ```bash
   flyctl tokens create deploy --app vapor-facilitator
   ```
5. Add `SETTLEMENT_SIGNER_PRIVATE_KEY` and `BASE_MAINNET_RPC_URL` as GitHub Actions repo secrets (Settings → Secrets and variables → Actions). These never get baked into the Docker image or exposed in logs — they're pushed to Fly as Fly secrets, which inject them as env vars into the running machine at boot.
6. Run the **"Sync secrets to Fly.io"** workflow once (Actions tab → Run workflow) to push those two values onto the Fly app.

## Ongoing deploys

Every push to `main` runs CI (typecheck, tests, build) and, if it passes, deploys automatically via the **"Deploy to Fly.io"** workflow. No manual step needed after the one-time setup above.

## Rotating secrets

Update the GitHub Actions secret value, then re-run the "Sync secrets to Fly.io" workflow manually. This is deliberately not automatic on every push — pushing an unchanged secret to Fly still triggers a machine restart, which there's no reason to do on every commit.

## Scaling beyond a single machine

`fly.toml`'s `min_machines_running = 1` keeps one instance always warm (no cold-start latency on payment verification). To scale further:
- Bump `[[vm]] size`/`memory` for more throughput per machine, or
- Increase `min_machines_running` and switch `DATABASE_URL` to a managed Postgres instance (`flyctl postgres create`) — SQLite on a single Fly volume doesn't support multiple machines writing concurrently. `prisma/schema.prisma`'s datasource `provider` would need to change from `sqlite` to `postgresql` at that point; the schema itself needs no other changes.
