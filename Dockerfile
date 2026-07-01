# ── Stage 1: dependency install ──────────────────────────────────────────────
FROM node:22-alpine AS deps

WORKDIR /app

# Copy only manifests first for better layer caching
COPY package*.json ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev

# ── Stage 2: production image ─────────────────────────────────────────────────
FROM node:22-alpine AS runner

# Install unzip for .docx diff support
RUN apk add --no-cache unzip

WORKDIR /app

# Run as non-root for security
RUN addgroup -S dms && adduser -S dms -G dms

# Copy installed modules and application source
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Ensure runtime data directory is writable by the dms user
RUN mkdir -p apps/api/runtime/blobs && chown -R dms:dms apps/api/runtime

USER dms

EXPOSE 3000

# Graceful shutdown via signal; health endpoint checked by orchestrator
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/api/server.mjs"]
