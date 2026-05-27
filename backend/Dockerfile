# Builder Stage
FROM node:22-alpine AS builder

WORKDIR /app

# Install all dependencies including devDependencies needed for tsc
COPY package*.json ./
RUN npm ci

# Copy source and compile
COPY tsconfig.json tsconfig.build.json ./
COPY migrations ./migrations
COPY src ./src
RUN npx tsc -p tsconfig.build.json

# Production Stage
FROM node:22-alpine AS production

WORKDIR /app

# Build-time metadata injected by the CI pipeline via --build-arg.
# These are baked into the image so GET /version works without any
# runtime environment variable configuration.
ARG GIT_SHA=""
ARG BUILD_TIME=""
ENV GIT_SHA=$GIT_SHA \
    BUILD_TIME=$BUILD_TIME

# Install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist
COPY migrations ./migrations

# Non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

EXPOSE 3001

# Liveness probe so Docker/Kubernetes and the GHCR staging image have a real
# health signal instead of defaulting to "running == healthy". Node 22 ships a
# global fetch, so no extra tooling (curl/wget) is needed in the image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
