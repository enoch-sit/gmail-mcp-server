# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

# Install dependencies first (layer caching)
COPY package*.json tsconfig.json ./
RUN npm ci

# Compile TypeScript
COPY src ./src
RUN npm run build

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM node:20-slim AS runtime

WORKDIR /app

# Production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev

# Compiled application
COPY --from=builder /app/dist ./dist

# Static files for the Web UI wizard
COPY public ./public

# Create credentials mount point with correct permissions
RUN mkdir -p /app/credentials

# Run as a non-root user for security
RUN groupadd -r mcp && useradd -r -g mcp -s /bin/false mcp \
    && chown -R mcp:mcp /app
USER mcp

# MCP servers communicate over stdio — no network port exposed by default.
# The Web UI wizard (npm run setup:ui) is NOT the default CMD; use
# docker-compose.setup.yml for that.
CMD ["node", "dist/index.js"]
