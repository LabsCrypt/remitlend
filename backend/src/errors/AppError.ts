/**
 * Custom application error class for centralized error handling.
 *
 * Extends the native Error class with HTTP status codes and operational
 * error classification. Operational errors are expected failures (e.g.,
 * invalid input, not found) vs programming bugs.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly status: "fail" | "error";
  public readonly isOperational: boolean;

  constructor(message: string, statusCode: number, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.status = statusCode >= 400 && statusCode < 500 ? "fail" : "error";
    this.isOperational = isOperational;

    // Preserve proper stack trace in V8 environments
    Error.captureStackTrace(this, this.constructor);
  }

  /* ── Factory Methods ─────────────────────────────────────────── */

  static badRequest(message = "Bad request", _code?: string, _field?: string): AppError {
    return new AppError(message, 400);
  }

  static unauthorized(message = "Unauthorized"): AppError {
    return new AppError(message, 401);
  }

  static forbidden(message = "Forbidden", _code?: string, _field?: string): AppError {
    return new AppError(message, 403);
  }

  static notFound(message = "Not found", _code?: string, _field?: string): AppError {
    return new AppError(message, 404);
  }

  static conflict(message = "Conflict"): AppError {
    return new AppError(message, 409);
  }

  static internal(message = "Internal server error"): AppError {
    return new AppError(message, 500, false);
  }
}
