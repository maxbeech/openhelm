FROM node:20-slim AS builder
WORKDIR /app

# Copy all package files BEFORE npm install so workspaces are recognized
COPY package.json package-lock.json ./
COPY worker/package.json ./worker/
COPY shared/package.json ./shared/
COPY shared/tsconfig.json ./shared/
COPY tsconfig.json tsconfig.node.json ./

# Install all deps (including devDeps) so esbuild is available at build time
RUN npm install

# Copy source code after dependencies are installed
COPY shared/src ./shared/src/
COPY worker/src ./worker/src/
COPY worker/tsconfig.json ./worker/

# Build worker
RUN npm --prefix worker run build

# Prune to production deps only before copying to final image
RUN npm prune --omit=dev

# ─── Production image ────────────────────────────────────────────────────────
FROM node:20-slim
WORKDIR /app

# Copy only production node_modules and built output
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/worker/dist ./dist
COPY --from=builder /app/worker/package.json ./package.json

# Non-root user for security
RUN useradd -m worker && chown -R worker:worker /app
USER worker

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s CMD \
  node -e "require('http').get('http://localhost:8080/health', r => process.exit(r.statusCode === 200 ? 0 : 1))"

CMD ["node", "dist/index.cjs"]
