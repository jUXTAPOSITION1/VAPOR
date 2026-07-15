# Pinned to a specific digest, not just the mutable "22-alpine" tag — a tag
# can be repointed (by upstream or a registry-level compromise) to a
# different image without any change showing up in this repo's history.
# Bumped from node:20-alpine (Node 20 hit its documented end-of-life
# 2026-04-30 — https://github.com/nodejs/Release) to node:22-alpine
# (Maintenance LTS through 2027-04-30, matching V.A.P.E's worker/'s own
# Node 22). Digest resolved via a real `docker pull` + `docker inspect`
# from a GitHub Actions runner (this repo's dev sandbox has no Docker
# daemon), not typed from memory. Refresh periodically with
# `docker pull node:22-alpine && docker inspect --format='{{index .RepoDigests 0}}' node:22-alpine`
# and re-verify the new digest the same way before updating it here.
FROM node:26-alpine@sha256:e88a35be04478413b7c71c455cd9865de9b9360e1f43456be5951032d7ac1a66 AS build
WORKDIR /app
# Alpine ships no OpenSSL by default; Prisma's engine binaries dynamically
# link against libssl and fail with an opaque "could not parse schema
# engine response" error at runtime without it.
RUN apk add --no-cache openssl
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

# Same pinned digest as the build stage above — keep them in sync.
FROM node:26-alpine@sha256:e88a35be04478413b7c71c455cd9865de9b9360e1f43456be5951032d7ac1a66 AS runtime
WORKDIR /app
# su-exec drops from root to the unprivileged `node` user (built into this
# base image) after docker-entrypoint.sh fixes ownership — see that file's
# comments for why the container still starts as root at all.
RUN apk add --no-cache openssl su-exec
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
# npm itself is only needed for this install step — the entrypoint invokes
# the installed `prisma` CLI directly from node_modules/.bin (see
# docker-entrypoint.sh) and then `node dist/server.js`, neither of which
# touches npm/npx — so npm's own vendored dependency tree is removed
# afterward. That tree is what Trivy was flagging (CVEs in npm's bundled
# cross-spawn/glob/minimatch/tar/sigstore, not in anything VAPOR actually
# depends on or ships), and removing it shrinks the real runtime attack
# surface too.
RUN npm ci --omit=dev && \
    rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY prisma ./prisma
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 3402
ENTRYPOINT ["./docker-entrypoint.sh"]
