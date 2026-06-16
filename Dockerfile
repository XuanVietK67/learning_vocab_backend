# syntax=docker/dockerfile:1

# Shared image for both Railway services (api + worker). The two services run
# the same image with different start commands: `node dist/main.js` (api) and
# `node dist/worker.js` (worker, set in railway.worker.json).

# ---- deps: production node_modules, with bcrypt compiled for the runtime base ----
FROM node:22-bookworm-slim AS deps
WORKDIR /app
# Toolchain for the bcrypt native addon (used only if no prebuilt binary).
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

# ---- build: full deps + compile TypeScript (tsc builder) and rewrite @/ aliases ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

# ---- runner: slim runtime, no toolchain ----
FROM node:22-bookworm-slim AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --chown=node:node package*.json ./
COPY --chown=node:node --from=deps /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
USER node
EXPOSE 3000
# api service default; the worker service overrides this with `node dist/worker.js`.
CMD ["node", "dist/main.js"]
