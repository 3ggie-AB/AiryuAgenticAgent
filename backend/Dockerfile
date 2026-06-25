# ── Build Stage ───────────────────────────────────────────────
FROM oven/bun:1.1-alpine AS base

WORKDIR /app

# Install system dependencies for better-sqlite3 and native modules
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    git \
    && rm -rf /var/cache/apk/*

# Copy package files
COPY package.json bun.lockb* ./

# Install dependencies
RUN bun install --frozen-lockfile 2>/dev/null || bun install

# Copy source code
COPY src/ ./src/
COPY tsconfig.json ./

# ── Runtime Stage ─────────────────────────────────────────────
FROM oven/bun:1.1-alpine AS runtime

WORKDIR /app

# Install runtime dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    && rm -rf /var/cache/apk/*

# Copy from build stage
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/src ./src
COPY --from=base /app/package.json ./

# Create data directory
RUN mkdir -p /app/data

# Expose API port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget -qO- http://localhost:3000/health || exit 1

# Default: start API server
CMD ["bun", "run", "src/index.ts", "serve", "/target"]
