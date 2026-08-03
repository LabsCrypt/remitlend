import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/AppError.js';

/**
 * Admin API key scopes.
 * A key without a scope prefix is treated as a legacy key that grants all scopes.
 * A scoped key has the format `<scope>:<value>` and grants only that one scope.
 */
export type ApiKeyScope = 'admin:disputes' | 'admin:indexer' | 'admin:webhooks' | 'admin:loans';

interface ParsedKey {
  scope: ApiKeyScope | null; // null = legacy (all scopes)
  value: string;
}

function parseConfiguredKeys(): ParsedKey[] {
  const raw = process.env.INTERNAL_API_KEY;
  if (!raw) return [];

  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry): ParsedKey => {
      // Scoped format: "<namespace>:<action>:<value>"
      const firstColon = entry.indexOf(':');
      const secondColon = firstColon >= 0 ? entry.indexOf(':', firstColon + 1) : -1;

      if (firstColon >= 0 && secondColon > firstColon) {
        const scope = entry.slice(0, secondColon) as ApiKeyScope;
        const value = entry.slice(secondColon + 1);

        return { scope, value };
      }

      // Legacy key (no scope restriction)
      return {
        scope: null,
        value: entry,
      };
    });
}

/**
 * Middleware that enforces API-key authentication and authorization.
 *
 * Behaviour:
 * - Legacy keys (no scope prefix) grant access to every endpoint.
 * - Scoped keys may access only endpoints requiring their exact scope.
 * - Calling requireApiKey() without a required scope accepts only legacy keys.
 */
export const requireApiKey = (requiredScope?: ApiKeyScope) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const configuredKeys = parseConfiguredKeys();

    if (configuredKeys.length === 0) {
      throw AppError.internal('Server misconfiguration: INTERNAL_API_KEY is not set');
    }

    const providedKey = req.headers['x-api-key'];

    if (!providedKey) {
      throw AppError.unauthorized('Unauthorised: missing API key');
    }

    const keyValue = Array.isArray(providedKey) ? providedKey[0]! : providedKey;

    /**
     * Step 1:
     * Authenticate by matching only the secret value.
     */
    const matchedKey = configuredKeys.find((configuredKey) => {
      const expected = Buffer.from(configuredKey.value);
      const provided = Buffer.from(keyValue);

      if (expected.length !== provided.length) {
        return false;
      }

      return crypto.timingSafeEqual(expected, provided);
    });

    if (!matchedKey) {
      throw AppError.unauthorized('Unauthorised: invalid API key');
    }

    /**
     * Step 2:
     * Authorize using the required scope.
     */
    if (requiredScope !== undefined) {
      // Legacy keys bypass scope checks.
      if (matchedKey.scope !== null && matchedKey.scope !== requiredScope) {
        throw AppError.forbidden(`Unauthorised: API key lacks required scope ${requiredScope}`);
      }

      (req as Request & { apiKeyScope?: ApiKeyScope }).apiKeyScope =
        matchedKey.scope ?? requiredScope;
    } else {
      // Unscoped endpoints should only accept legacy keys.
      if (matchedKey.scope !== null) {
        throw AppError.forbidden('Unauthorised: scoped API keys cannot access this endpoint');
      }
    }

    next();
  };
};
