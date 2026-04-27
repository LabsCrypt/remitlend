/**
 * POST /api/auth/register (TEST/DEV ONLY)
 * Registers a test user with email and password. Returns a fake JWT.
 */
// Only import types once at the top
import type { Request, Response, NextFunction } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
export const registerTestUser = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const { email, password } = req.body;
    if (!email || !password) {
      res
        .status(400)
        .json({ success: false, message: "Email and password required" });
      return;
    }
    // In real app, insert user into DB. For test, just return a fake token.
    // Use email as publicKey for test JWT.
    const token = `test-jwt-for-${email}`;
    res.json({ success: true, token });
  },
);
import { AppError } from "../errors/AppError.js";
import { ErrorCode } from "../errors/errorCodes.js";
import {
  generateChallenge,
  verifySignature,
  verifyChallengeTimestamp,
  generateJwtToken,
} from "../services/authService.js";
import logger from "../utils/logger.js";

const logAuthFailure = (
  req: Request,
  publicKey: string | undefined,
  reason: string,
): void => {
  logger.warn("Auth attempt failed", {
    ip: req.ip,
    publicKey,
    reason,
    path: req.path,
    method: req.method,
  });
};

export const requestChallenge = (req: Request, res: Response): void => {
  const { publicKey } = req.body;

  if (!publicKey || typeof publicKey !== "string") {
    logAuthFailure(req, publicKey, "missing_public_key");
    throw AppError.badRequest(
      "Public key is required",
      ErrorCode.MISSING_FIELD,
      "publicKey",
    );
  }

  let challenge;
  try {
    challenge = generateChallenge(publicKey);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Invalid Stellar public key"
    ) {
      logAuthFailure(req, publicKey, "invalid_public_key");
      throw AppError.badRequest(
        "Invalid Stellar public key",
        ErrorCode.INVALID_PUBLIC_KEY,
        "publicKey",
      );
    }
    throw error;
  }

  res.status(200).json({
    success: true,
    data: challenge,
  });
};

export const login = (req: Request, res: Response): void => {
  const { publicKey, message, signature } = req.body;

  if (!publicKey || typeof publicKey !== "string") {
    logAuthFailure(req, publicKey, "missing_public_key");
    throw AppError.badRequest(
      "Public key is required",
      ErrorCode.MISSING_FIELD,
      "publicKey",
    );
  }

  if (!message || typeof message !== "string") {
    logAuthFailure(req, publicKey, "missing_message");
    throw AppError.badRequest(
      "Message is required",
      ErrorCode.MISSING_FIELD,
      "message",
    );
  }

  if (!signature || typeof signature !== "string") {
    logAuthFailure(req, publicKey, "missing_signature");
    throw AppError.badRequest(
      "Signature is required",
      ErrorCode.MISSING_FIELD,
      "signature",
    );
  }

  const timestampMatch = message.match(/Timestamp: (\d+)/);
  if (!timestampMatch) {
    logAuthFailure(req, publicKey, "invalid_challenge_format");
    throw AppError.badRequest(
      "Invalid challenge message format",
      ErrorCode.INVALID_CHALLENGE,
    );
  }

  const timestamp = parseInt(timestampMatch[1]!, 10);
  if (!verifyChallengeTimestamp(timestamp)) {
    logAuthFailure(req, publicKey, "challenge_expired");
    throw AppError.unauthorized(
      "Challenge has expired",
      ErrorCode.CHALLENGE_EXPIRED,
    );
  }

  const isValidSignature = verifySignature(publicKey, message, signature);
  if (!isValidSignature) {
    logAuthFailure(req, publicKey, "invalid_signature");
    throw AppError.unauthorized(
      "Invalid signature",
      ErrorCode.INVALID_SIGNATURE,
    );
  }

  const token = generateJwtToken(publicKey);
  const cookieName = process.env.JWT_COOKIE_NAME ?? "remitlend_jwt";

  // Set secure, HTTP-only cookie to avoid leaking tokens in URL query parameters
  // for EventSource (SSE) connections.
  res.cookie(cookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
  });

  res.status(200).json({
    success: true,
    data: {
      token,
      publicKey,
    },
  });
};

export const verify = (req: Request, res: Response): void => {
  res.status(200).json({
    success: true,
    data: {
      publicKey: req.user?.publicKey,
      role: req.user?.role,
      scopes: req.user?.scopes,
      valid: true,
    },
  });
};
