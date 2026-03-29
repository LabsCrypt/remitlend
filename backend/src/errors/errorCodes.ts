/**
 * Centralized error code definitions for API responses.
 *
 * Error codes are machine-readable identifiers that allow the frontend to:
 * - Map errors to i18n translations
 * - Programmatically handle specific error cases
 * - Display user-friendly error messages
 *
 * Format: CATEGORY_ERROR_NAME
 */

export enum ErrorCode {
  // Validation Errors (400)
  INVALID_AMOUNT = "INVALID_AMOUNT",
  INVALID_PUBLIC_KEY = "INVALID_PUBLIC_KEY",
  INVALID_SIGNATURE = "INVALID_SIGNATURE",
  INVALID_CHALLENGE = "INVALID_CHALLENGE",
  MISSING_FIELD = "MISSING_FIELD",
  VALIDATION_ERROR = "VALIDATION_ERROR",

  // Authentication Errors (401)
  UNAUTHORIZED = "UNAUTHORIZED",
  TOKEN_EXPIRED = "TOKEN_EXPIRED",
  TOKEN_INVALID = "TOKEN_INVALID",
  CHALLENGE_EXPIRED = "CHALLENGE_EXPIRED",

  // Authorization Errors (403)
  FORBIDDEN = "FORBIDDEN",
  ACCESS_DENIED = "ACCESS_DENIED",

  // Not Found Errors (404)
  NOT_FOUND = "NOT_FOUND",
  LOAN_NOT_FOUND = "LOAN_NOT_FOUND",
  USER_NOT_FOUND = "USER_NOT_FOUND",
  POOL_NOT_FOUND = "POOL_NOT_FOUND",

  // Conflict Errors (409)
  CONFLICT = "CONFLICT",
  DUPLICATE_REQUEST = "DUPLICATE_REQUEST",

  // Rate Limiting (429)
  RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED",

  // Server Errors (500)
  INTERNAL_ERROR = "INTERNAL_ERROR",
  DATABASE_ERROR = "DATABASE_ERROR",
  EXTERNAL_SERVICE_ERROR = "EXTERNAL_SERVICE_ERROR",
  BLOCKCHAIN_ERROR = "BLOCKCHAIN_ERROR",

  // Specific Business Logic Errors
  BORROWER_MISMATCH = "BORROWER_MISMATCH",
  INSUFFICIENT_BALANCE = "INSUFFICIENT_BALANCE",
  LOAN_ALREADY_REPAID = "LOAN_ALREADY_REPAID",
  LOAN_NOT_ACTIVE = "LOAN_NOT_ACTIVE",
  INVALID_LOAN_ID = "INVALID_LOAN_ID",
  INVALID_TX_XDR = "INVALID_TX_XDR",
}

/**
 * Error code metadata for documentation and frontend consumption.
 */
export interface ErrorCodeMetadata {
  code: ErrorCode;
  message: string;
  httpStatus: number;
  description: string;
  suggestedAction?: string;
}

/**
 * Centralized error code registry with metadata.
 */
export const ERROR_CODE_REGISTRY: Record<ErrorCode, ErrorCodeMetadata> = {
  // Validation Errors
  [ErrorCode.INVALID_AMOUNT]: {
    code: ErrorCode.INVALID_AMOUNT,
    message: "Amount must be a positive number",
    httpStatus: 400,
    description: "The provided amount is invalid or not a positive number",
    suggestedAction: "Provide a valid positive number for the amount field",
  },
  [ErrorCode.INVALID_PUBLIC_KEY]: {
    code: ErrorCode.INVALID_PUBLIC_KEY,
    message: "Invalid Stellar public key",
    httpStatus: 400,
    description: "The provided Stellar public key format is invalid",
    suggestedAction: "Provide a valid Stellar public key (starts with 'G')",
  },
  [ErrorCode.INVALID_SIGNATURE]: {
    code: ErrorCode.INVALID_SIGNATURE,
    message: "Invalid signature",
    httpStatus: 400,
    description: "The provided cryptographic signature is invalid",
    suggestedAction: "Sign the challenge message with your wallet and retry",
  },
  [ErrorCode.INVALID_CHALLENGE]: {
    code: ErrorCode.INVALID_CHALLENGE,
    message: "Invalid challenge format",
    httpStatus: 400,
    description: "The challenge message format is invalid",
    suggestedAction: "Request a new challenge and retry",
  },
  [ErrorCode.MISSING_FIELD]: {
    code: ErrorCode.MISSING_FIELD,
    message: "Required field is missing",
    httpStatus: 400,
    description: "A required field was not provided in the request",
    suggestedAction: "Check the request body and include all required fields",
  },
  [ErrorCode.VALIDATION_ERROR]: {
    code: ErrorCode.VALIDATION_ERROR,
    message: "Validation failed",
    httpStatus: 400,
    description: "Request validation failed",
    suggestedAction: "Review the validation errors and correct the input",
  },

  // Authentication Errors
  [ErrorCode.UNAUTHORIZED]: {
    code: ErrorCode.UNAUTHORIZED,
    message: "Unauthorized",
    httpStatus: 401,
    description: "Authentication is required to access this resource",
    suggestedAction: "Provide valid authentication credentials",
  },
  [ErrorCode.TOKEN_EXPIRED]: {
    code: ErrorCode.TOKEN_EXPIRED,
    message: "Token has expired",
    httpStatus: 401,
    description: "The JWT token has expired",
    suggestedAction: "Log in again to obtain a new token",
  },
  [ErrorCode.TOKEN_INVALID]: {
    code: ErrorCode.TOKEN_INVALID,
    message: "Invalid token",
    httpStatus: 401,
    description: "The JWT token is invalid or malformed",
    suggestedAction: "Log in again to obtain a new token",
  },
  [ErrorCode.CHALLENGE_EXPIRED]: {
    code: ErrorCode.CHALLENGE_EXPIRED,
    message: "Challenge has expired",
    httpStatus: 401,
    description: "The challenge message has expired (valid for 5 minutes)",
    suggestedAction: "Request a new challenge and sign it",
  },

  // Authorization Errors
  [ErrorCode.FORBIDDEN]: {
    code: ErrorCode.FORBIDDEN,
    message: "Forbidden",
    httpStatus: 403,
    description: "You do not have permission to access this resource",
    suggestedAction: "Ensure you have the required permissions",
  },
  [ErrorCode.ACCESS_DENIED]: {
    code: ErrorCode.ACCESS_DENIED,
    message: "Access denied",
    httpStatus: 403,
    description: "Access to this resource is denied",
    suggestedAction: "Contact support if you believe this is an error",
  },
  [ErrorCode.BORROWER_MISMATCH]: {
    code: ErrorCode.BORROWER_MISMATCH,
    message: "Borrower public key must match your authenticated wallet",
    httpStatus: 403,
    description: "The borrower public key does not match the authenticated user",
    suggestedAction: "Ensure the borrower public key matches your wallet",
  },

  // Not Found Errors
  [ErrorCode.NOT_FOUND]: {
    code: ErrorCode.NOT_FOUND,
    message: "Resource not found",
    httpStatus: 404,
    description: "The requested resource does not exist",
    suggestedAction: "Verify the resource ID and try again",
  },
  [ErrorCode.LOAN_NOT_FOUND]: {
    code: ErrorCode.LOAN_NOT_FOUND,
    message: "Loan not found",
    httpStatus: 404,
    description: "The specified loan does not exist",
    suggestedAction: "Verify the loan ID and try again",
  },
  [ErrorCode.USER_NOT_FOUND]: {
    code: ErrorCode.USER_NOT_FOUND,
    message: "User not found",
    httpStatus: 404,
    description: "The specified user does not exist",
    suggestedAction: "Verify the user ID and try again",
  },
  [ErrorCode.POOL_NOT_FOUND]: {
    code: ErrorCode.POOL_NOT_FOUND,
    message: "Pool not found",
    httpStatus: 404,
    description: "The specified pool does not exist",
    suggestedAction: "Verify the pool address and try again",
  },

  // Conflict Errors
  [ErrorCode.CONFLICT]: {
    code: ErrorCode.CONFLICT,
    message: "Conflict",
    httpStatus: 409,
    description: "The request conflicts with the current state of the resource",
    suggestedAction: "Review the resource state and retry",
  },
  [ErrorCode.DUPLICATE_REQUEST]: {
    code: ErrorCode.DUPLICATE_REQUEST,
    message: "Duplicate request",
    httpStatus: 409,
    description: "This request has already been processed",
    suggestedAction: "Check if the operation was already completed",
  },

  // Rate Limiting
  [ErrorCode.RATE_LIMIT_EXCEEDED]: {
    code: ErrorCode.RATE_LIMIT_EXCEEDED,
    message: "Rate limit exceeded",
    httpStatus: 429,
    description: "Too many requests. Please try again later",
    suggestedAction: "Wait before making another request",
  },

  // Server Errors
  [ErrorCode.INTERNAL_ERROR]: {
    code: ErrorCode.INTERNAL_ERROR,
    message: "Internal server error",
    httpStatus: 500,
    description: "An unexpected error occurred on the server",
    suggestedAction: "Please try again later or contact support",
  },
  [ErrorCode.DATABASE_ERROR]: {
    code: ErrorCode.DATABASE_ERROR,
    message: "Database error",
    httpStatus: 500,
    description: "A database error occurred",
    suggestedAction: "Please try again later or contact support",
  },
  [ErrorCode.EXTERNAL_SERVICE_ERROR]: {
    code: ErrorCode.EXTERNAL_SERVICE_ERROR,
    message: "External service error",
    httpStatus: 500,
    description: "An external service failed to respond",
    suggestedAction: "Please try again later or contact support",
  },
  [ErrorCode.BLOCKCHAIN_ERROR]: {
    code: ErrorCode.BLOCKCHAIN_ERROR,
    message: "Blockchain error",
    httpStatus: 500,
    description: "A blockchain operation failed",
    suggestedAction: "Please try again later or contact support",
  },

  // Business Logic Errors
  [ErrorCode.INSUFFICIENT_BALANCE]: {
    code: ErrorCode.INSUFFICIENT_BALANCE,
    message: "Insufficient balance",
    httpStatus: 400,
    description: "The account has insufficient balance for this operation",
    suggestedAction: "Deposit more funds or reduce the amount",
  },
  [ErrorCode.LOAN_ALREADY_REPAID]: {
    code: ErrorCode.LOAN_ALREADY_REPAID,
    message: "Loan already repaid",
    httpStatus: 400,
    description: "This loan has already been fully repaid",
    suggestedAction: "No further action is needed for this loan",
  },
  [ErrorCode.LOAN_NOT_ACTIVE]: {
    code: ErrorCode.LOAN_NOT_ACTIVE,
    message: "Loan is not active",
    httpStatus: 400,
    description: "This loan is not in an active state",
    suggestedAction: "Verify the loan status and try again",
  },
  [ErrorCode.INVALID_LOAN_ID]: {
    code: ErrorCode.INVALID_LOAN_ID,
    message: "Invalid loan ID",
    httpStatus: 400,
    description: "The provided loan ID is invalid",
    suggestedAction: "Provide a valid numeric loan ID",
  },
  [ErrorCode.INVALID_TX_XDR]: {
    code: ErrorCode.INVALID_TX_XDR,
    message: "Invalid transaction XDR",
    httpStatus: 400,
    description: "The provided transaction XDR is invalid or malformed",
    suggestedAction: "Provide a valid signed transaction XDR",
  },
};

/**
 * Helper function to get error code metadata.
 */
export function getErrorCodeMetadata(code: ErrorCode): ErrorCodeMetadata {
  return ERROR_CODE_REGISTRY[code];
}

/**
 * Helper function to map HTTP status codes to default error codes.
 */
export function getDefaultErrorCodeForStatus(status: number): ErrorCode {
  switch (status) {
    case 400:
      return ErrorCode.VALIDATION_ERROR;
    case 401:
      return ErrorCode.UNAUTHORIZED;
    case 403:
      return ErrorCode.FORBIDDEN;
    case 404:
      return ErrorCode.NOT_FOUND;
    case 409:
      return ErrorCode.CONFLICT;
    case 429:
      return ErrorCode.RATE_LIMIT_EXCEEDED;
    case 500:
    default:
      return ErrorCode.INTERNAL_ERROR;
  }
}
