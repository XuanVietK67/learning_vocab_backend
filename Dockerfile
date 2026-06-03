# syntax=docker/dockerfile:1

# ---- build stage: compile TypeScript -> dist ----
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime stage ----
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# ffmpeg (bundles ffprobe) is required at runtime to transcode uploaded
# pronunciation audio to the raw PCM Azure Speech expects. This is the system
# binary fluent-ffmpeg shells out to.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist

EXPOSE 3000
# Note: run DB migrations (npm run db:migration:run) as a separate deploy step;
# this image only carries the compiled app, not ts-node/src.
CMD ["node", "dist/main"]
