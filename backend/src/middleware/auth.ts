import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { AppError } from "../errors/AppError.js";

/**
 * Admin API key scopes.
 * A key without a scope prefix is treated as a legacy key that grants all scopes.
 * A scoped key has the format `<scope>:<value>` and grants only that one scope.
 */
export type ApiKeyScope =
  | "admin:disputes"
  | "admin:indexer"
  | "admin:webhooks"
  | "admin:loans";

interface ParsedKey {
  scope: ApiKeyScope | null; // null = legacy (all scopes)
  value: string;
}

function parseConfiguredKeys(): ParsedKey[] {
  const raw = process.env.INTERNAL_API_KEY;
  if (!raw) return [];

  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry): ParsedKey => {
      // Scoped format: "<namespace>:<action>:<value>".
      const firstColon = entry.indexOf(":");
      const secondColon =
        firstColon >= 0 ? entry.indexOf(":", firstColon + 1) : -1;

      if (firstColon >= 0 && secondColon > firstColon) {
        const scope = entry.slice(0, secondColon) as ApiKeyScope;
        const value = entry.slice(secondColon + 1);
        return { scope, value };
      }

      // Legacy key: no scope restriction.
      return { scope: null, value: entry };
    });
}

/**
 * Middleware that enforces API-key access control.
 *
 * When a scope is provided, the request must supply a key that either has that
 * exact scope or is a legacy key. Calling requireApiKey() without an explicit
 * scope now accepts only legacy keys, so scoped keys cannot accidentally drift
 * into unrelated admin surfaces.
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
    let valueMatched = false;

    const match = configuredKeys.find((k) => {
      const expectedBuf = Buffer.from(k.value);
      const providedBuf = Buffer.from(keyStr);
      if (expectedBuf.length !== providedBuf.length) return false;
      if (!crypto.timingSafeEqual(expectedBuf, providedBuf)) return false;

      valueMatched = true;

      if (requiredScope === undefined) return k.scope === null;
      if (k.scope === null) return true; // legacy key grants all scopes
      return k.scope === requiredScope;
    });

    if (!match) {
      if (valueMatched && requiredScope !== undefined) {
        throw AppError.forbidden(
          `Unauthorised: API key lacks required scope ${requiredScope}`,
        );
      }

      throw AppError.unauthorized("Unauthorised: invalid or missing API key");
    }

    if (requiredScope !== undefined) {
      (req as Request & { apiKeyScope?: ApiKeyScope }).apiKeyScope =
        requiredScope;
    }

    next();
  };
};
