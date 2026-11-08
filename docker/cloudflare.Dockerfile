FROM node:24.22.1-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates python3 make g++ libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable && corepack prepare pnpm@9.15.1 --activate
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build:cloudflare-container
# Exercise the actual native pipeline and retain downloaded model weights in the image.
RUN node --import tsx scripts/probe-container-native.ts

FROM node:24.22.1-bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libgomp1 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/.cache/transformers ./.cache/transformers
ENV HOST=0.0.0.0 PORT=4321 NODE_ENV=production DEPLOY_TARGET=cloudflare-container
USER node
EXPOSE 4321
CMD ["node", "dist/server/entry.mjs"]
