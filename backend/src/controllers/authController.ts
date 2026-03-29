import type { Request, Response } from "express";
import { AppError } from "../errors/AppError.js";
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
    throw AppError.badRequest("Public key is required");
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
      throw AppError.badRequest("Invalid Stellar public key");
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
    throw AppError.badRequest("Public key is required");
  }

  if (!message || typeof message !== "string") {
    logAuthFailure(req, publicKey, "missing_message");
    throw AppError.badRequest("Message is required");
  }

  if (!signature || typeof signature !== "string") {
    logAuthFailure(req, publicKey, "missing_signature");
    throw AppError.badRequest("Signature is required");
  }

  const timestampMatch = message.match(/Timestamp: (\d+)/);
  if (!timestampMatch) {
    logAuthFailure(req, publicKey, "invalid_challenge_format");
    throw AppError.badRequest("Invalid challenge message format");
  }

  const timestamp = parseInt(timestampMatch[1]!, 10);
  if (!verifyChallengeTimestamp(timestamp)) {
    logAuthFailure(req, publicKey, "challenge_expired");
    throw AppError.badRequest("Challenge has expired");
  }

  const isValidSignature = verifySignature(publicKey, message, signature);
  if (!isValidSignature) {
    logAuthFailure(req, publicKey, "invalid_signature");
    throw AppError.unauthorized("Invalid signature");
  }

  const token = generateJwtToken(publicKey);

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
