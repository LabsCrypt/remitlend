# Runbooks

Operational runbooks for on-call engineers working on the RemitLend platform.

## Index

- [Indexer Recovery](indexer-recovery.md) — Responding to indexer lag, RPC outages, and quarantined events.

## Purpose

These runbooks provide step-by-step procedures for diagnosing and resolving common production incidents. They are meant to be followed in order during an incident, with clear escalation points at each stage.

# Staging Deployment Runbook

## Overview

This runbook describes the staging deployment process used by the GitHub Actions workflow (`deploy-staging.yml`), including required configuration, deployment flow, health checks, troubleshooting, and manual rollback procedures.

---

## Prerequisites

### GitHub Actions Variable

The staging deployment job is gated by the repository variable:

| Variable          | Required | Description                                          |
| ----------------- | -------- | ---------------------------------------------------- |
| `STAGING_ENABLED` | Yes      | Must be set to `true` for the deployment job to run. |

Configure under:

**Repository Settings → Secrets and variables → Actions → Variables**

Example:

```text
STAGING_ENABLED=true
```

If the variable is not set to `true`, container images will still be built and published, but deployment to the staging server will be skipped.

---

## Required GitHub Secrets

The workflow requires the following repository secrets:

| Secret             | Description                                  |
| ------------------ | -------------------------------------------- |
| `STAGING_SSH_HOST` | Hostname or IP address of the staging server |
| `STAGING_SSH_USER` | SSH username used for deployment             |
| `STAGING_SSH_KEY`  | Private SSH key used by GitHub Actions       |
| `STAGING_SSH_PORT` | SSH port (defaults to 22 if not provided)    |

Configure under:

**Repository Settings → Secrets and variables → Actions → Secrets**

---

## Container Images

The workflow publishes staging images to GHCR:

### Backend

```text
ghcr.io/<owner>/remitlend-backend:staging-latest
ghcr.io/<owner>/remitlend-backend:staging-<commit-sha>
```

### Frontend

```text
ghcr.io/<owner>/remitlend-frontend:staging-latest
ghcr.io/<owner>/remitlend-frontend:staging-<commit-sha>
```

Before pushing new images, the workflow backs up the current staging images as:

```text
ghcr.io/<owner>/remitlend-backend:staging-previous
ghcr.io/<owner>/remitlend-frontend:staging-previous
```

These tags are used for rollback.

---

## Deployment Flow

The deployment workflow performs the following steps:

1. Build backend and frontend images.
2. Backup existing `staging-latest` images as `staging-previous`.
3. Push new staging images to GHCR.
4. Generate deployment compose files.
5. Copy compose files to the staging server.
6. Pull updated images.
7. Start the PostgreSQL database.
8. Wait for database readiness.
9. Run database migrations:

```bash
npm run migrate:up
```

10. Start backend and frontend services.
11. Execute health checks.
12. Automatically roll back if health checks fail.

---

## Staging Services

### Database

```text
postgres:16-alpine
```

Database name:

```text
remitlend
```

### Redis

```text
redis:alpine
```

### Backend

Exposed port:

```text
3001
```

### Frontend

Exposed port:

```text
3000
```

---

## Health Checks

The deployment is considered successful only if both checks pass.

### Backend

```bash
curl http://localhost:3001/health
```

Expected result:

```text
HTTP 200 OK
```

### Frontend

```bash
curl http://localhost:3000/
```

Expected result:

The frontend application responds successfully.

---

## Viewing Logs

SSH into the staging server:

```bash
ssh -p <port> <user>@<host>
```

Navigate to the deployment directory:

```bash
cd ~/remitlend
```

### Backend Logs

```bash
docker-compose \
  -f docker-compose.yml \
  -f docker-compose.staging.resolved.yml \
  logs backend
```

### Frontend Logs

```bash
docker-compose \
  -f docker-compose.yml \
  -f docker-compose.staging.resolved.yml \
  logs frontend
```

### Database Logs

```bash
docker-compose \
  -f docker-compose.yml \
  -f docker-compose.staging.resolved.yml \
  logs db
```

### Follow Logs

```bash
docker-compose \
  -f docker-compose.yml \
  -f docker-compose.staging.resolved.yml \
  logs -f
```

---

## Automatic Rollback

If deployment health checks fail, the workflow automatically:

1. Pulls the `staging-previous` backend image.
2. Pulls the `staging-previous` frontend image.
3. Uses the generated rollback compose file.
4. Restarts services with the previous image versions.

---

## Manual Rollback

Use this procedure if the automated rollback fails or requires manual intervention.

### 1. Connect to the Staging Server

```bash
ssh -p <port> <user>@<host>
```

### 2. Change to the Deployment Directory

```bash
cd ~/remitlend
```

### 3. Verify Rollback Compose File Exists

```bash
ls deploy/docker-compose.staging.rollback.yml
```

### 4. Pull Previous Images

```bash
docker pull ghcr.io/<owner>/remitlend-backend:staging-previous
docker pull ghcr.io/<owner>/remitlend-frontend:staging-previous
```

### 5. Deploy Previous Version

```bash
docker-compose \
  -f docker-compose.yml \
  -f docker-compose.staging.rollback.yml \
  up -d --remove-orphans
```

### 6. Verify Service Health

Backend:

```bash
curl http://localhost:3001/health
```

Frontend:

```bash
curl http://localhost:3000/
```

### 7. Review Logs

```bash
docker-compose \
  -f docker-compose.yml \
  -f docker-compose.staging.rollback.yml \
  logs -f
```

Confirm that backend and frontend services start successfully before closing the incident.
