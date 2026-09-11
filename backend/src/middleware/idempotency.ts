import { createHash } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { cacheService } from '../services/cacheService.js';
import logger from '../utils/logger.js';

const IDEMPOTENCY_TTL = 24 * 60 * 60; // 24 hours in seconds
const LOCK_TTL_SECONDS = 30;

interface CachedResponse {
  status: number;
  body: unknown;
  // #1067: request fingerprint (method + path + body hash) captured when the
  // response was first stored. On a cache hit the middleware re-validates it
  // against the current request and rejects a mismatched reuse instead of
  // blindly replaying a response intended for a different operation.
  fingerprint: string;
}

// Canonically stringify a value so the body hash is deterministic regardless of
// JSON object key ordering. Handles nested objects/arrays; primitives fall back
// to JSON.stringify. Large payloads are hashed in a single streaming pass.
function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(',')}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts = keys.map(
    (k) => `${JSON.stringify(k)}:${canonicalStringify((value as Record<string, unknown>)[k])}`,
  );
  return `{${parts.join(',')}}`;
}

function hashBody(body: unknown): string {
  const canonical = canonicalStringify(body ?? null);
  return createHash('sha256').update(canonical).digest('hex');
}

interface RequestFingerprint {
  fingerprint: string;
  method: string;
  path: string;
  bodyHash: string;
}

/**
 * Compute a deterministic fingerprint that uniquely identifies the request the
 * Idempotency-Key is being applied to: HTTP method + path (query stripped) +
 * SHA-256 of the canonicalised request body.
 *
 * Binding the key to the fingerprint closes the cross-endpoint replay hole from
 * #1067 — a client that reuses one Idempotency-Key for a *different* operation
 * (different route or different body) must not receive the cached response of
 * the first operation.
 */
export function computeFingerprint(req: Request): RequestFingerprint {
  const method = req.method;
  const path = (req.originalUrl ?? `${req.baseUrl ?? ''}${req.path ?? ''}`).split('?')[0] ?? '';
  const bodyHash = hashBody(req.body);
  return { fingerprint: `${method} ${path}#${bodyHash}`, method, path, bodyHash };
}

/**
 * Middleware to handle Idempotency-Key headers.
 *
 * If the key is present and a cached response exists whose stored request
 * fingerprint matches the current request, the cached response is replayed
 * (`X-Idempotent-Replayed: true`). A reused key whose fingerprint differs is
 * rejected with 409 Conflict so it can never replay a response meant for a
 * different method/path/body (cross-endpoint replay, #1067).
 *
 * On a cache miss an atomic in-flight reservation is taken (Redis SET NX)
 * before the handler runs; a concurrent duplicate request that cannot acquire
 * the reservation is rejected with 409 rather than double-executing. When the
 * request finishes the reservation is released and (for 2xx/4xx) the response
 * is persisted alongside its fingerprint for future replays.
 */
export const idempotencyMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const key = req.header('Idempotency-Key');

  if (!key) {
    return next();
  }

  try {
    const { fingerprint } = computeFingerprint(req);
    const cacheKey = `idemp:${key}`;
    const lockKey = `idemp:${key}:lock`;
    const cached = await cacheService.get<CachedResponse>(cacheKey);

    if (cached) {
      // #1067: a stored entry is only valid for the exact same request it was
      // created by. Reusing the key for a different method/path/body is a
      // conflict, not a replay — reject rather than serve the wrong result.
      if (cached.fingerprint !== fingerprint) {
        logger.warn(`Idempotency key ${key} reused for a different request`, {
          url: req.originalUrl,
          method: req.method,
          expectedFingerprint: cached.fingerprint,
          actualFingerprint: fingerprint,
        });
        res.status(409).json({
          error:
            'This Idempotency-Key was already used for a different request (method, path, or body).',
        });
        return;
      }

      logger.info(`Idempotency hit for key: ${key}`, {
        url: req.originalUrl,
        method: req.method,
      });

      // X-Idempotent-Replayed: true signals to the client that this response
      // is a cached replay of a prior request, not a fresh execution.
      // Clients can use this to de-duplicate toasts and avoid double-counting.
      res
        .status(cached.status)
        .set('X-Idempotency-Cache', 'HIT')
        .set('X-Idempotent-Replayed', 'true')
        .json(cached.body);
      return;
    }

    // Acquire an in-flight lock to prevent concurrent duplicate executions.
    // If another request with the same key is already being processed,
    // reject this one with 409 Conflict.
    const lockAcquired = await cacheService.setNotExists(
      lockKey,
      { pid: process.pid, startedAt: Date.now() },
      LOCK_TTL_SECONDS,
    );

    if (!lockAcquired) {
      res.status(409).json({
        error: 'A request with this Idempotency-Key is already in progress.',
      });
      return;
    }

    // Capture the original methods to intercept the response body
    const originalJson = res.json;
    const originalSend = res.send;

    let responseBody: unknown;

    // Override res.json
    res.json = function (body: unknown) {
      responseBody = body;
      return originalJson.call(this, body);
    };

    // Override res.send (as res.json eventually calls res.send)
    res.send = function (body: unknown) {
      if (!responseBody) {
        if (typeof body === 'string') {
          try {
            responseBody = JSON.parse(body);
          } catch {
            responseBody = body;
          }
        } else {
          responseBody = body;
        }
      }
      return originalSend.call(this, body);
    };

    // X-Idempotent-Replayed: false on the first (fresh) execution so the
    // client always receives the header and can branch on its value.
    res.set('X-Idempotent-Replayed', 'false');

    // Store the response in cache once the request is finished
    res.on('finish', async () => {
      // Release the in-flight lock
      try {
        await cacheService.delete(lockKey);
      } catch {
        // Lock will expire via TTL if deletion fails
      }

      // Only cache 2xx and 4xx status codes.
      // 5xx errors should usually be retried without returning a cached failure.
      if (res.statusCode >= 200 && res.statusCode < 500 && responseBody) {
        try {
          await cacheService.set(
            cacheKey,
            {
              status: res.statusCode,
              body: responseBody,
              fingerprint,
            },
            IDEMPOTENCY_TTL,
          );
        } catch (error) {
          logger.error(`Error caching idempotency key ${key}`, { error });
        }
      }
    });

    next();
  } catch (error) {
    logger.error('Error in idempotency middleware', { error, key });
    next();
  }
};
