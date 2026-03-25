import type { Request, Response, NextFunction } from "express";
import { AppError } from "../errors/AppError.js";
import {
  verifyJwtToken,
  extractBearerToken,
  type JwtPayload,
} from "../services/authService.js";

declare module "express" {
  interface Request {
    user?: JwtPayload;
  }
}

export const requireJwtAuth = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  const authHeader = req.headers.authorization;

  const token = extractBearerToken(authHeader);
  if (!token) {
    throw AppError.unauthorized("Missing or invalid Authorization header");
  }

  const payload = verifyJwtToken(token);
  if (!payload) {
    throw AppError.unauthorized("Invalid or expired token");
  }

  req.user = payload;
  next();
};

export const optionalJwtAuth = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  const authHeader = req.headers.authorization;

  const token = extractBearerToken(authHeader);
  if (!token) {
    return next();
  }

  const payload = verifyJwtToken(token);
  if (payload) {
    req.user = payload;
  }

  next();
};

export const requireWalletOwnership = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  const requestedWallet = req.params.wallet || req.body.wallet;
  const authenticatedWallet = req.user?.publicKey;

  if (!authenticatedWallet) {
    throw AppError.unauthorized("Authentication required");
  }

  if (!requestedWallet) {
    throw AppError.badRequest("Wallet address is required");
  }

  if (requestedWallet !== authenticatedWallet) {
    throw AppError.forbidden("You are not authorized to access this wallet");
  }

  next();
};

export const requireBorrower = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  if (!req.user?.publicKey) {
    throw AppError.unauthorized("Authentication required");
  }

  next();
};

export const requireLender = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  if (!req.user?.publicKey) {
    throw AppError.unauthorized("Authentication required");
  }

  next();
};

export { JwtPayload };
