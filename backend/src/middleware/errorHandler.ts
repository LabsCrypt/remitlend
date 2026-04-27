import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { AppError } from "../errors/AppError.js";
import { ErrorCode } from "../errors/errorCodes.js";
import logger from "../utils/logger.js";
import { Sentry } from "../config/sentry.js";

/**
 * Global error handling middleware.
 *
 * Must be registered LAST in the Express middleware chain (after all
 * routes). Catches all errors forwarded via `next(err)` and returns
 * a consistent JSON error response with structured error codes.
 *
 * Response format for backward compatibility:
 * - Includes both new structured format (error.code, error.message)
 * - And legacy format (message, errors) for existing tests/clients
 */
export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  // ── Zod Validation Errors ────────────────────────────────────
  if (err instanceof z.ZodError) {
    const details = err.issues.map((issue: z.ZodIssue) => ({
      field: issue.path.join("."),
      message: issue.message,
      code: issue.code,
    }));

    // Get the first failing field for quick reference
    const firstField = details.length > 0 ? details[0]?.field : undefined;

    res.status(400).json({
      success: false,
      // Legacy format for backward compatibility
      message: "Validation failed",
      errors: err.issues.map((issue: z.ZodIssue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
      // New structured format
      error: {
        code: ErrorCode.VALIDATION_ERROR,
        message: "Validation failed",
        field: firstField,
        details,
      },
    });
    return;
  }

  // ── Known Operational Errors ─────────────────────────────────
  if (err instanceof AppError) {
    const message = err.isOperational ? err.message : "Internal server error";

    if (!err.isOperational) {
      logger.error(`Internal AppError: ${err.message}`, {
        requestId: req.requestId,
        path: req.path,
        method: req.method,
        stack: err.stack,
      });
      Sentry.captureException(err, {
        extra: { path: req.path, method: req.method },
      });
    }

    const errorResponse: any = {
      success: false,
      // Legacy format for backward compatibility
      message: err.isOperational ? err.message : "Internal server error",
      // New structured format
      error: {
        code: err.errorCode,
        message: err.isOperational ? err.message : "Internal server error",
      },
    };

    // Include field information if present
    if (err.field) {
      errorResponse.error.field = err.field;
      errorResponse.field = err.field; // Legacy format
    }

    // Include additional details if present
    if (err.details) {
      errorResponse.error.details = err.details;
    }

    res.status(err.statusCode).json(errorResponse);
    return;
  }

  // ── Unexpected / Programming Errors ──────────────────────────
  logger.error("Unhandled error", {
    requestId: req.requestId,
    message: err.message,
    name: err.name,
    ...(err.stack && { stack: err.stack }),
  });

  Sentry.captureException(err);

  const shouldExposeStackTrace =
    process.env.NODE_ENV === "development" &&
    process.env.EXPOSE_STACK_TRACES === "true";

  res.status(500).json({
    success: false,
    // Legacy format
    message: "Internal server error",
    error: {
      code: ErrorCode.INTERNAL_ERROR,
      message: "Internal server error",
    },
    ...(shouldExposeStackTrace && { stack: err.stack }),
  });
};
