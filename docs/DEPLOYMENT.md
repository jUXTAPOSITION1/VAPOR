# Deployment (Oracle Cloud)

VAPOR deploys to a plain Docker host via SSH — no PaaS lock-in, works on any VM including Oracle Cloud Infrastructure's (OCI) Always Free compute shapes (the Ampere A1 ARM shape gives up to 4 OCPUs / 24GB RAM at no cost, which is comfortably more than this service needs).

## One-time setup (do this yourself — these are your account's actions)

### 1. Provision the instance

In the OCI console: **Compute → Instances → Create Instance**.
- Image: Ubuntu 22.04 (or later) — pick the **Ampere (ARM)** shape under "Always Free eligible" if available in your region; the AMD Micro shape also works, just with less headroom.
- Add your SSH public key during creation (or after, via cloud-init).
- Note the instance's **public IP**.

### 2. Open the firewall

Two layers both need a rule for port 3402 (or whatever `PORT` you use) inbound, and 22 for SSH:
- OCI **Security List** / **Network Security Group** on the instance's subnet — add an ingress rule for TCP/3402 (and 22, usually already open).
- The instance's own OS firewall (Ubuntu ships with `iptables` rules OCI's image preconfigures for port 22 only) — run on the instance:
  ```bash
  sudo iptables -I INPUT -p tcp --dport 3402 -j ACCEPT
  sudo netfilter-persistent save
  ```

If you have a domain, put a reverse proxy (Caddy or nginx) in front for TLS rather than exposing 3402 directly — not included here since it depends on your domain/DNS setup; ask if you want this wired in.

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
| `SSH_PRIVATE_KEY` | the private key matching the public key on the instance |
| `BASE_MAINNET_RPC_URL` | your RPC endpoint (already added) |
| `SETTLEMENT_SIGNER_PRIVATE_KEY` | your funded signer wallet's key (already added) |

The last two never touch the Docker image or GitHub Actions logs — the workflow writes them into a `.env` file on the instance (`chmod 600`) that only `docker compose` reads at container start.

## Ongoing deploys

Every push to `main` runs CI (typecheck, tests, build) and, if it passes, the **"Deploy to Oracle Cloud"** workflow: syncs the repo to `/opt/vapor` via `rsync` over SSH, writes the `.env`, and runs `docker compose up -d --build`. No manual step needed after the one-time setup above.

## Rotating secrets

Update the GitHub Actions secret value, then either push any commit to `main` or manually trigger the "Deploy to Oracle Cloud" workflow (Actions tab → Run workflow) — the `.env` file is rewritten from the current secret values on every deploy.

## Data persistence

The SQLite audit log lives in the `vapor-data` Docker volume, which persists across deploys/restarts on the instance (it's not touched by `rsync` or `docker compose up --build`, only the image is rebuilt). Back up `/var/lib/docker/volumes/vapor_vapor-data` if you want an off-instance copy.

## Scaling beyond one instance

Single-instance SQLite doesn't support multiple machines writing concurrently. To run more than one: switch `prisma/schema.prisma`'s datasource `provider` from `sqlite` to `postgresql`, point `DATABASE_URL` at a managed or self-hosted Postgres instance, and put a load balancer in front of however many OCI instances you add.
