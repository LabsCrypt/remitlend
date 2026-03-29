import type { Request, Response, NextFunction } from "express";
import { AppError } from "../errors/AppError.js";

/**
 * Middleware that enforces API-key access control.
 *
 * Callers must provide the `x-api-key` header whose value matches the
 * `INTERNAL_API_KEY` environment variable.  This gate is applied to
 * mutating score endpoints so that only trusted services (e.g. LoanManager
 * off-chain workers) can update credit scores.
 */
export const requireApiKey = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  const providedKey = req.headers["x-api-key"];
  const expectedKey = process.env.INTERNAL_API_KEY;

  if (!expectedKey) {
    throw AppError.internal(
      "Server misconfiguration: INTERNAL_API_KEY is not set",
    );
  }

  if (!providedKey || providedKey !== expectedKey) {
    throw AppError.unauthorized("Unauthorised: invalid or missing API key");
  }

  next();
};
