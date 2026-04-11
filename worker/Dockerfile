FROM node:20-slim AS builder
WORKDIR /app

COPY package.json ./
# Install all deps (including devDeps) so esbuild and tsc are available at build time
RUN npm install

COPY src/ ./src/
COPY tsconfig.json ./
RUN npm run build

# Prune to production deps only before copying to final image
RUN npm prune --omit=dev

# ─── Production image ────────────────────────────────────────────────────────
FROM node:20-slim
WORKDIR /app

# Copy only production node_modules and built output
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

# Non-root user for security
RUN useradd -m worker && chown -R worker:worker /app
USER worker

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s CMD \
  node -e "require('http').get('http://localhost:8080/health', r => process.exit(r.statusCode === 200 ? 0 : 1))"

CMD ["node", "dist/index.cjs"]
