# Middleware

This directory contains all Express middleware used by the backend.

## Middleware chain order (`app.ts`)

Applied in this order for every request:

1. `helmet` (third-party) — security headers, CSP.
2. `cors` (third-party) — origin allowlist enforcement.
3. `compression` (third-party) — response gzip/deflate.
4. `express.json` (third-party) — JSON body parsing, capped at 100kb.
5. **`globalRateLimiter`** (`rateLimiter.ts`) — global per-IP request rate limit.
6. **`requestIdMiddleware`** (`requestId.ts`) — assigns/propagates `x-request-id`.
7. **`requestLogger`** (`requestLogger.ts`) — structured request/response logging.
8. **`metricsMiddleware`** (`metrics.ts`) — records Prometheus HTTP metrics.
9. **`pauseGuard`** (`pauseGuard.ts`) — rejects state-mutating requests while contracts are paused.
10. _(routes mounted here)_
11. **`Sentry.setupExpressErrorHandler`** — captures forwarded errors for Sentry.
12. **`errorHandler`** (`errorHandler.ts`) — final centralized error handler, must stay last.

Additional middleware below are applied per-route (not globally in `app.ts`) via individual router files.

## Middleware reference

| File                     | Description                                                                                                           |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `auditLog.ts`            | Sanitizes and logs mutating requests for the audit trail, stripping sensitive fields from the body before persisting. |
| `auth.ts`                | `requireApiKey` — validates admin API keys and enforces scope-based access for internal/admin routes.                 |
| `errorHandler.ts`        | Centralized Express error handler; formats and returns all forwarded errors. Must be registered last.                 |
| `idempotency.ts`         | Handles `Idempotency-Key` headers, returning a cached response when a key has already been processed.                 |
| `jwtAuth.ts`             | `requireJwtAuth` — validates JWTs and caps embedded scopes to the wallet's current on-chain role.                     |
| `loanAccess.ts`          | Used after `requireJwtAuth`; ensures `req.params.loanId` belongs to the authenticated borrower.                       |
| `metrics.ts`             | `metricsMiddleware`/`metricsHandler` — records and exposes Prometheus HTTP metrics.                                   |
| `pauseGuard.ts`          | Blocks state-mutating requests when the relevant on-chain contract is paused.                                         |
| `rateLimiter.ts`         | `globalRateLimiter`/`strictRateLimiter` — general-purpose per-IP rate limiting used in `app.ts`.                      |
| `rateLimitMiddleware.ts` | Configurable rate limiting middleware for specific routes, with pluggable request-identifier extraction.              |
| `requestId.ts`           | Assigns/propagates a unique `x-request-id` per request for tracing.                                                   |
| `requestLogger.ts`       | Logs structured HTTP request fields (method, url, statusCode, durationMs).                                            |
| `validation.ts`          | `validateBody`/`validateQuery`/`validateParams` — validates request data against Zod schemas.                         |

## Usage

The `validate*` middleware functions accept a Zod schema and validate the corresponding part of the request against it.

### Example

```typescript
import { validateBody } from '../middleware/validation.js';
import { mySchema } from '../schemas/mySchemas.js';

router.post('/endpoint', validateBody(mySchema), myController);
```

## Schema Structure

Schemas should validate the following request properties:

- `body` - Request body data
- `params` - URL parameters
- `query` - Query string parameters

### Example Schema

```typescript
import { z } from 'zod';

export const mySchema = z.object({
  body: z.object({
    name: z.string().min(1),
    age: z.number().positive(),
  }),
  params: z.object({
    id: z.string(),
  }),
});
```

## Error Response Format

When validation fails, the middleware returns a 400 status with:

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    {
      "path": "body.fieldName",
      "message": "Error message"
    }
  ]
}
```
