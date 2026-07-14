#!/bin/sh
set -eu

# Runs briefly as root (the container's default user, since there's no
# USER directive in the Dockerfile) ONLY to fix ownership, then drops
# straight to the unprivileged `node` user (built into the node:*-alpine
# base image) for everything else — migration and the actual long-running
# server process never run as root.
#
# The chown is idempotent and cheap (a small SQLite file plus the app's
# own code), so it's safe to run on every single container start,
# INCLUDING against a volume that predates this container ever running as
# non-root — an already-deployed instance's /data was created and written
# to entirely as root before this change shipped, and would otherwise be
# unwritable by `node` on the first non-root start.
chown -R node:node /data /app

# Invoked as the locally-installed binary, not via `npx` — npm/npx are
# removed from the runtime image after install (see Dockerfile), since
# `prisma` is a direct production dependency and its CLI already lands in
# node_modules/.bin without needing npm present to resolve/run it.
exec su-exec node sh -c './node_modules/.bin/prisma migrate deploy && exec node dist/server.js'
