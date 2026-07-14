# Deployment (Oracle Cloud)

VAPOR deploys to a plain Docker host via SSH — no PaaS lock-in, works on any VM including Oracle Cloud Infrastructure's (OCI) Always Free compute shapes (the Ampere A1 ARM shape gives up to 4 OCPUs / 24GB RAM at no cost, which is comfortably more than this service needs).

## One-time setup (do this yourself — these are your account's actions)

### 1. Provision the instance

In the OCI console: **Compute → Instances → Create Instance**.
- Image: Ubuntu 22.04 (or later) — pick the **Ampere (ARM)** shape under "Always Free eligible" if available in your region; the AMD Micro shape also works, just with less headroom.
- Add your SSH public key during creation (or after, via cloud-init).
- Note the instance's **public IP**.

### 2. Open the firewall

Two layers both need rules for ports 80 and 443 (Caddy's public HTTPS entrypoint — see step 6) and 22 for SSH:
- OCI **Security List** / **Network Security Group** on the instance's subnet — add ingress rules for TCP/80, TCP/443 (and 22, usually already open).
- The instance's own OS firewall — run on the instance:
  ```bash
  sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
  sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
  sudo netfilter-persistent save 2>/dev/null || sudo iptables-save | sudo tee /etc/iptables/rules.v4 >/dev/null
  ```
Port 3402 itself no longer needs to be open — `docker-compose.yml` binds it to `127.0.0.1` only; Caddy is the sole public entrypoint.

### 3. Install Docker on the instance

```bash
ssh ubuntu@<instance-ip>
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
# log out and back in for the group change to take effect
```

### 4. Clone the repo once

```bash
sudo mkdir -p /opt/vapor && sudo chown $USER:$USER /opt/vapor
git clone https://github.com/jUXTAPOSITION1/VAPOR.git /opt/vapor
```
(The deploy workflow overwrites this directory's contents on every deploy via `rsync`, so the initial clone just needs to exist — it doesn't need to stay up to date manually.)

### 5. Add GitHub Actions repo secrets

Settings → Secrets and variables → Actions:

| Secret | Value |
|---|---|
| `SSH_HOST` | the instance's public IP |
| `SSH_USER` | `ubuntu` (or your image's default user) |
| `SSH_PRIVATE_KEY_B64` | the private key matching the public key on the instance, **base64-encoded** (`base64 -w0 your_key`) |
| `BASE_MAINNET_RPC_URL` | your RPC endpoint (already added) — comma-separate several (`https://primary,https://backup`) for automatic failover; see `src/blockchain/clients/chain.client.ts` |
| `SETTLEMENT_SIGNER_PRIVATE_KEY` | your funded signer wallet's key (already added) |

`SSH_PRIVATE_KEY_B64` is base64-encoded rather than pasted as a raw multi-line PEM block because copy/paste through a browser or chat client can silently corrupt line breaks in a multi-line key, which then fails with an opaque `error in libcrypto` at connect time. A single base64 line survives copy/paste intact; the workflow decodes it back to the real key before connecting.

The last two never touch the Docker image or GitHub Actions logs — the workflow writes them into a `.env` file on the instance (`chmod 600`) that only `docker compose` reads at container start.

### 6. Public HTTPS via DuckDNS + Caddy

VAPOR's live domain is a free [DuckDNS](https://www.duckdns.org) subdomain rather than a purchased one — DuckDNS gives a real DNS name that Let's Encrypt (via Caddy, already wired into `docker-compose.yml`/`Caddyfile`) can issue a certificate for, which a purchased-domain setup would otherwise require.

On the instance (one-time), set up a cron job that keeps the DuckDNS record pointed at this instance's current public IP — the IP is not guaranteed stable across reboots, and it already changed once during this project's own setup:

```bash
mkdir -p ~/duckdns
cat > ~/duckdns/duck.sh <<'EOF'
echo url="https://www.duckdns.org/update?domains=x402&token=YOUR_DUCKDNS_TOKEN&ip=" | curl -k -o ~/duckdns/duck.log -K -
EOF
chmod 700 ~/duckdns/duck.sh
(crontab -l 2>/dev/null; echo "*/5 * * * * ~/duckdns/duck.sh >/dev/null 2>&1") | crontab -
~/duckdns/duck.sh
cat ~/duckdns/duck.log   # should print "OK"
```

Once DNS resolves and ports 80/443 are open (step 2 above), the next deploy brings up a `caddy` container alongside `vapor` — Caddy requests and renews the Let's Encrypt certificate for the domain in `Caddyfile` automatically, no manual certificate step. The public site's dashboard (`docs/assets/app.js`) already points `API_BASE` at this domain.

## Ongoing deploys

Every push to `main` runs CI (typecheck, tests, `npm audit --omit=dev --audit-level=high` against production dependencies, build) and a Trivy scan of the built container image (fails on a fixable CRITICAL/HIGH OS-package or dependency vulnerability). Only if both pass does the **"Deploy to Oracle Cloud"** job run: syncs the repo to `/opt/vapor` via `rsync` over SSH, writes the `.env`, and runs `docker compose up -d --build`. No manual step needed after the one-time setup above.

## Rotating secrets

Update the GitHub Actions secret value, then either push any commit to `main` or manually trigger the "Deploy to Oracle Cloud" workflow (Actions tab → Run workflow) — the `.env` file is rewritten from the current secret values on every deploy.

## Data persistence

The SQLite audit log lives in the `vapor-data` Docker volume, which persists across deploys/restarts on the instance (it's not touched by `rsync` or `docker compose up --build`, only the image is rebuilt). Back up `/var/lib/docker/volumes/vapor_vapor-data` if you want an off-instance copy.

## Container user

The app process runs as the unprivileged `node` user, not root — `docker-entrypoint.sh` starts as root only long enough to `chown` `/data` and `/app`, then drops privileges via `su-exec` before running migrations or starting the server. That `chown` is idempotent and runs on every start, so it also fixes up a volume that was created and written to as root by an earlier version of this image (e.g. an instance that's been running since before this hardening shipped) — no manual intervention needed on an existing deployment.

## Scaling beyond one instance

Single-instance SQLite doesn't support multiple machines writing concurrently. To run more than one: switch `prisma/schema.prisma`'s datasource `provider` from `sqlite` to `postgresql`, point `DATABASE_URL` at a managed or self-hosted Postgres instance, and put a load balancer in front of however many OCI instances you add.
