# Environment Variable Reference

## Demo Mode

| Variable | Default | Description |
|----------|---------|-------------|
| `DEMO_MODE` | (unset) | Enables sandbox responses for demo-gated routes |

## Backend (`backend/`)

| Variable | Description | Source |
|----------|-------------|--------|
| `BACKEND_ONLY_KEY` | A backend-only key | `backend/src/config/index.ts` |

## Frontend (`frontend/`)

| Variable | Description | Source |
|----------|-------------|--------|
| `NEXT_PUBLIC_API_URL` | Backend API base URL | `frontend/src/app/hooks/useApi.ts` |
| `SENTRY_ORG` | Sentry organization slug | `frontend/sentry.client.config.ts` |
| `SENTRY_PROJECT` | Sentry project slug | `frontend/sentry.client.config.ts` |
| `SENTRY_AUTH_TOKEN` | Sentry auth token for source maps | `frontend/next.config.ts` |

## Contracts / Scripts (`contracts/`, `scripts/`)

| Variable | Description | Source |
|----------|-------------|--------|
| `SOROBAN_RPC_URL` | RPC URL for contract deployment | `scripts/deploy.ts` |
