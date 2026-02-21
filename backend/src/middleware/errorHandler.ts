import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { AppError } from "../errors/AppError.js";
import logger from "../utils/logger.js";

/**
 * Global error handling middleware.
 *
 * Must be registered LAST in the Express middleware chain (after all
 * routes). Catches all errors forwarded via `next(err)` and returns
 * a consistent JSON error response.
 */
export const errorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  // ── Zod Validation Errors ────────────────────────────────────
  // Preserves the existing response format from validation.ts so
  // that current tests and clients remain backward-compatible.
  if (err instanceof z.ZodError) {
    res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: err.issues.map((issue: z.ZodIssue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
    return;
  }

  // ── Known Operational Errors ─────────────────────────────────
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
    });
    return;
  }

  // ── Unexpected / Programming Errors ──────────────────────────
  logger.error("Unhandled error:", err);

  const isDevelopment = process.env.NODE_ENV !== "production";

  res.status(500).json({
    success: false,
    message: "Internal server error",
    ...(isDevelopment && { stack: err.stack }),
  });
};
