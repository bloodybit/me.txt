FROM oven/bun:1.1-alpine

WORKDIR /app

# Bring in workspace manifests + lockfile so `bun install` resolves the
# workspace package (@ipd/contracts) and external deps in one go.
COPY package.json bun.lock* ./
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json

RUN bun install --frozen-lockfile || bun install

# Source comes in last so dependency layers cache.
COPY apps/api ./apps/api
COPY packages/contracts ./packages/contracts
COPY tsconfig.json ./

WORKDIR /app/apps/api

EXPOSE 8080
CMD ["bun", "run", "src/index.ts"]
