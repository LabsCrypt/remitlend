import { ErrorCode, ERROR_CODE_REGISTRY, getDefaultErrorCodeForStatus } from "./errorCodes.js";

/**
 * Custom application error class for centralized error handling.
 *
 * Extends the native Error class with HTTP status codes, error codes,
 * and operational error classification. Operational errors are expected
 * failures (e.g., invalid input, not found) vs programming bugs.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly status: "fail" | "error";
  public readonly isOperational: boolean;
  public readonly errorCode: ErrorCode;
  public readonly field?: string | undefined;
  public readonly details?: Record<string, unknown> | undefined;

  constructor(
    message: string,
    statusCode: number,
    isOperational = true,
    errorCode?: ErrorCode,
    field?: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.statusCode = statusCode;
    this.status = statusCode >= 400 && statusCode < 500 ? "fail" : "error";
    this.isOperational = isOperational;
    this.errorCode = errorCode ?? getDefaultErrorCodeForStatus(statusCode);
    this.field = field;
    this.details = details;

    // Preserve proper stack trace in V8 environments
    Error.captureStackTrace(this, this.constructor);
  }

  /* ── Factory Methods ─────────────────────────────────────────── */

  static badRequest(
    message = "Bad request",
    errorCode?: ErrorCode,
    field?: string,
  ): AppError {
    return new AppError(message, 400, true, errorCode ?? ErrorCode.INVALID_AMOUNT, field);
  }

  static unauthorized(
    message = "Unauthorized",
    errorCode?: ErrorCode,
  ): AppError {
    return new AppError(message, 401, true, errorCode ?? ErrorCode.UNAUTHORIZED);
  }

  static forbidden(
    message = "Forbidden",
    errorCode?: ErrorCode,
  ): AppError {
    return new AppError(message, 403, true, errorCode ?? ErrorCode.FORBIDDEN);
  }

  static notFound(
    message = "Not found",
    errorCode?: ErrorCode,
    field?: string,
  ): AppError {
    return new AppError(message, 404, true, errorCode ?? ErrorCode.NOT_FOUND, field);
  }

  static conflict(
    message = "Conflict",
    errorCode?: ErrorCode,
  ): AppError {
    return new AppError(message, 409, true, errorCode ?? ErrorCode.CONFLICT);
  }

  static internal(
    message = "Internal server error",
    errorCode?: ErrorCode,
  ): AppError {
    return new AppError(message, 500, false, errorCode ?? ErrorCode.INTERNAL_ERROR);
  }

  /**
   * Create a validation error with field information.
   */
  static validation(
    message = "Validation failed",
    field?: string,
    details?: Record<string, unknown>,
  ): AppError {
    return new AppError(
      message,
      400,
      true,
      ErrorCode.VALIDATION_ERROR,
      field,
      details,
    );
  }

  /**
   * Create an error with custom error code and field.
   */
  static withCode(
    errorCode: ErrorCode,
    message?: string,
    field?: string,
    details?: Record<string, unknown>,
  ): AppError {
    const metadata = ERROR_CODE_REGISTRY[errorCode];
    return new AppError(
      message ?? metadata.message,
      metadata.httpStatus,
      true,
      errorCode,
      field,
      details,
    );
  }
}
