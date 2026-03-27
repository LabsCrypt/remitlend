import type { Request, Response, NextFunction } from "express";
import { AppError } from "../errors/AppError.js";
import { type UserRole } from "../auth/rbac.js";
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

  // For SSE connections the browser's EventSource API cannot set custom
  // headers, so we also accept the token as a `?token=` query parameter.
  // We prioritise the Authorization header when both are present.
  const rawQueryToken =
    typeof req.query.token === "string" ? req.query.token : undefined;

  const token = extractBearerToken(authHeader) ?? rawQueryToken ?? null;
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
  const requestedWallet =
    req.params.borrower ??
    req.params.wallet ??
    (req.body as { wallet?: string } | undefined)?.wallet;
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

/**
 * Ensures a path param (e.g. `userId` on GET /score/:userId) matches the JWT wallet.
 */
export const requireWalletParamMatchesJwt = (paramName: string) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const requested = req.params[paramName];
    const authenticatedWallet = req.user?.publicKey;

    if (!authenticatedWallet) {
      throw AppError.unauthorized("Authentication required");
    }

    if (!requested) {
      throw AppError.badRequest(`${paramName} is required`);
    }

    if (requested !== authenticatedWallet) {
      throw AppError.forbidden(
        "You are not authorized to access this resource",
      );
    }

    next();
  };
};

export const requireBorrower = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  if (!req.user?.publicKey)
    throw AppError.unauthorized("Authentication required");
  if (req.user.role !== "borrower" && req.user.role !== "admin") {
    throw AppError.forbidden("Borrower role required");
  }

  next();
};

export const requireLender = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  if (!req.user?.publicKey)
    throw AppError.unauthorized("Authentication required");
  if (req.user.role !== "lender" && req.user.role !== "admin") {
    throw AppError.forbidden("Lender role required");
  }

  next();
};

export const requireRoles = (...roles: UserRole[]) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user?.publicKey) {
      throw AppError.unauthorized("Authentication required");
    }

    if (!roles.includes(req.user.role)) {
      throw AppError.forbidden("Insufficient role permissions");
    }

    next();
  };
};

export const requireScopes = (...requiredScopes: string[]) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user?.publicKey) {
      throw AppError.unauthorized("Authentication required");
    }

    const grantedScopes = new Set(req.user.scopes ?? []);
    if (grantedScopes.has("admin:all")) {
      return next();
    }

    const missingScope = requiredScopes.find(
      (scope) => !grantedScopes.has(scope),
    );

    if (missingScope) {
      throw AppError.forbidden(`Missing required scope: ${missingScope}`);
    }

    next();
  };
};

export { JwtPayload };
