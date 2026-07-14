FROM node:20-alpine AS build
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

FROM node:20-alpine AS runtime
WORKDIR /app
# su-exec drops from root to the unprivileged `node` user (built into this
# base image) after docker-entrypoint.sh fixes ownership — see that file's
# comments for why the container still starts as root at all.
RUN apk add --no-cache openssl su-exec
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY prisma ./prisma
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 3402
ENTRYPOINT ["./docker-entrypoint.sh"]
