# Environment Variable Reference

## Backend (`backend/`)

| Variable | Description | Source |
|----------|-------------|--------|
| `BACKEND_ONLY_KEY` | A backend-only key | `backend/src/config/index.ts` |
| `SENTRY_AUTH_TOKEN` | Frontend key wrongly listed under Backend | `frontend/next.config.ts` |

## Frontend (`frontend/`)

| Variable | Description | Source |
|----------|-------------|--------|
| `NEXT_PUBLIC_API_URL` | Backend API base URL | `frontend/src/app/hooks/useApi.ts` |
| `SENTRY_ORG` | Sentry organization slug | `frontend/sentry.client.config.ts` |
