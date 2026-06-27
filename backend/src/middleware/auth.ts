import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { AppError } from "../errors/AppError.js";

/**
 * Admin API key scopes.
 * A key without a scope prefix is treated as a legacy key that grants all scopes.
 * A scoped key has the format  `<scope>:<secret>` and grants only that one scope.
 *
 * Current scopes:
 *   admin:disputes  – dispute resolution endpoints
 *   admin:indexer   – reindex / quarantine-events endpoints
 *   admin:webhooks  – webhook management endpoints
 *   admin:loans     – loan default-check endpoints
 */
export type ApiKeyScope =
  | "admin:disputes"
  | "admin:indexer"
  | "admin:webhooks"
  | "admin:loans";

/**
 * Parse the comma-separated INTERNAL_API_KEY environment variable into an
 * array of `{ scope, secret }` entries.  A value without a colon is treated as
 * a legacy key that matches every scope.
 *
 * Supported formats (comma-separated list):
 *   - `mysecret`                    → legacy, all scopes
 *   - `admin:disputes:mysecret`     → scoped key
 *   - `admin:loans:sec1,admin:disputes:sec2` → two scoped keys
 */
interface ParsedKey {
  scope: ApiKeyScope | null; // null = legacy (all scopes)
  secret: string;
}

function parseConfiguredKeys(): ParsedKey[] {
  const raw = process.env.INTERNAL_API_KEY;
  if (!raw) return [];

  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry): ParsedKey => {
      // Scoped format: "<namespace>:<action>:<secret>"  (two colons minimum)
      const firstColon = entry.indexOf(":");
      const secondColon =
        firstColon >= 0 ? entry.indexOf(":", firstColon + 1) : -1;

      if (firstColon >= 0 && secondColon > firstColon) {
        const scope = entry.slice(0, secondColon) as ApiKeyScope;
        const secret = entry.slice(secondColon + 1);
        return { scope, secret };
      }

      // Legacy key – no scope restriction
      return { scope: null, secret: entry };
    });
}

/**
 * Middleware that enforces API-key access control.
 *
 * When called without a required scope it behaves exactly as before: any valid
 * key is accepted.  When a scope is provided the request must supply a key that
 * either has that exact scope OR is a legacy (scope-less) key.
 *
 * Backwards compatibility:
 *   A key configured without a scope prefix is treated as a legacy key with
 *   access to ALL scopes, so existing deployments continue to work unchanged.
 *
 * @param requiredScope  Optional scope that the key must grant.
 */
export const requireApiKey = (requiredScope?: ApiKeyScope) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const configuredKeys = parseConfiguredKeys();

    if (configuredKeys.length === 0) {
      throw AppError.internal(
        "Server misconfiguration: INTERNAL_API_KEY is not set",
      );
    }

    const providedKey = req.headers["x-api-key"];
    if (!providedKey) {
      throw AppError.unauthorized("Unauthorised: missing API key");
    }

    const keyStr = Array.isArray(providedKey) ? providedKey[0] : providedKey;

    const match = configuredKeys.find((k) => {
      const expectedBuf = Buffer.from(k.secret);
      const providedBuf = Buffer.from(keyStr);
      if (expectedBuf.length !== providedBuf.length) return false;
      if (!crypto.timingSafeEqual(expectedBuf, providedBuf)) return false;
      if (requiredScope === undefined) return true; // any valid key is fine
      if (k.scope === null) return true; // legacy key grants all scopes
      return k.scope === requiredScope;
    });

    if (!match) {
      throw AppError.unauthorized("Unauthorised: invalid or missing API key");
    }

    // Attach the resolved scope to the request for downstream use
    if (requiredScope !== undefined) {
      (req as Request & { apiKeyScope?: ApiKeyScope }).apiKeyScope =
        requiredScope;
    }

    next();
  };
};
