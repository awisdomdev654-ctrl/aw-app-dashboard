# =============================================================================
# backend/Dockerfile
# Multi-stage production build for Gatekeeper Audio — Next.js / Node.js
#
# Requires next.config.ts to include: output: 'standalone'
# This slims the final image from ~1GB to ~200MB by copying only the files
# Next.js reports as actually needed at runtime.
#
# Why four stages instead of three:
#   next.config.ts forces Next.js to invoke the TypeScript compiler during
#   config parsing — before the actual build begins. This happens outside the
#   normal build pipeline and requires 'typescript' to be resolvable from the
#   project root at that exact moment. Splitting prod deps from dev deps into
#   two separate stages guarantees the builder always has devDependencies
#   (including 'typescript') without polluting the final runner image.
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1 — base
# Shared Alpine base with libc6-compat (required by some native Node modules
# on Alpine). Both dependency stages inherit from here.
# -----------------------------------------------------------------------------
FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app

# -----------------------------------------------------------------------------
# Stage 2 — deps-prod
# Production dependencies only. Copied into the final runner image so it
# stays as small as possible.
# -----------------------------------------------------------------------------
FROM base AS deps-prod
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --frozen-lockfile

# -----------------------------------------------------------------------------
# Stage 3 — deps-dev
# ALL dependencies including devDependencies (typescript, @types/*, eslint…).
# NODE_ENV is forced to 'development' here so npm never strips devDeps,
# regardless of what the host environment has set.
# This is the stage the builder uses — never the runner.
# -----------------------------------------------------------------------------
FROM base AS deps-dev
ENV NODE_ENV=development
COPY package.json package-lock.json* ./
RUN npm ci --frozen-lockfile

# -----------------------------------------------------------------------------
# Stage 4 — builder
# Copies ALL deps (including typescript) from deps-dev so next.config.ts
# can be parsed correctly, then builds the standalone Next.js output.
# Runtime secrets are NOT passed here — they stay out of the image cache.
# -----------------------------------------------------------------------------
FROM base AS builder
WORKDIR /app

# Full dep tree (including devDependencies / typescript) from deps-dev
COPY --from=deps-dev /app/node_modules ./node_modules
# Source files — this COPY comes after node_modules so source changes don't
# bust the npm install cache layer
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN mkdir -p ./public
RUN npm run build

# -----------------------------------------------------------------------------
# Stage 5 — runner (final image, ~200MB)
# Only the standalone output, static assets, and production node_modules.
# No source files, no devDependencies, no typescript compiler.
# Runs as a non-root user — stems are unreleased IP, root is a bad look.
# -----------------------------------------------------------------------------
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Non-root user
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# Production node_modules (no typescript, no dev tooling)
COPY --from=deps-prod /app/node_modules ./node_modules

# Standalone server + compiled pages (public/ omitted — API-only backend,
# no static assets to serve)
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Runtime secrets (MONGODB_URI, AWS creds, GATEKEEPER_*) are injected by
# docker-compose or your deployment platform — never baked into the image.
CMD ["node", "server.js"]