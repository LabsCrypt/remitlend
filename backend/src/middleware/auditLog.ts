import type { Request, Response, NextFunction } from "express";
import { query } from "../db/connection.js";
import logger from "../utils/logger.js";

/**
 * Sanitizes the request body to remove sensitive fields before logging.
 */
function sanitizePayload(body: any): any {
  if (!body || typeof body !== "object") return body;

  const sanitized = { ...body };
  // List of fields that should be redacted in audit logs
  const sensitiveFields = [
    "secret",
    "apiKey",
    "password",
    "token",
    "signedTxXdr",
    "x-api-key",
  ];

  for (const field of sensitiveFields) {
    if (field in sanitized) {
      sanitized[field] = "[REDACTED]";
    }
  }

  // Handle nested objects if necessary (shallow for now)
  return sanitized;
}

/**
 * Extracts a target identifier from the request based on parameters or body fields.
 */
function extractTarget(req: Request): string | undefined {
  // Check common path parameters
  if (req.params.id) return `ID:${req.params.id}`;
  if (req.params.loanId) return `LoanID:${req.params.loanId}`;
  if (req.params.address) return `Address:${req.params.address}`;
  if (req.params.userId) return `UserID:${req.params.userId}`;
  if (req.params.borrower) return `Borrower:${req.params.borrower}`;

  // Check common body fields
  const body = req.body as any;
  if (body) {
    if (body.loanId) return `LoanID:${body.loanId}`;
    if (Array.isArray(body.loanIds))
      return `LoanIDs:[${body.loanIds.join(",")}]`;
    if (body.address) return `Address:${body.address}`;
    if (body.userId) return `UserID:${body.userId}`;
    if (body.publicKey) return `PublicKey:${body.publicKey}`;
    if (body.borrowerPublicKey) return `Borrower:${body.borrowerPublicKey}`;
  }

  return undefined;
}

/**
 * Middleware to log admin API actions to the audit_logs table.
 * It identifies the actor (JWT user or API key), the action (method+path),
 * any target entity, and the sanitized request payload.
 */
export const auditLog = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const actor =
      req.user?.publicKey ??
      (req.headers["x-api-key"] ? "INTERNAL_API_KEY" : "unknown");
    const action = `${req.method} ${req.path}`;
    const target = extractTarget(req);
    const payload = sanitizePayload(req.body);
    const ipAddress =
      req.ip ||
      (req.headers["x-forwarded-for"] as string)?.split(",")[0] ||
      req.socket.remoteAddress;

    // Log the action asynchronously to avoid blocking the main request thread
    void (async () => {
      try {
        await query(
          `INSERT INTO audit_logs (actor, action, target, payload, ip_address)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            actor,
            action,
            target ?? null,
            payload ? JSON.stringify(payload) : null,
            ipAddress ?? null,
          ],
        );
      } catch (err) {
        logger.error("Audit logging failure", {
          err,
          actor,
          action,
          target,
        });
      }
    })();
  } catch (err) {
    // If the audit log logic fails, we still want to proceed with the request
    logger.warn("Audit log middleware error", { err });
  }

  next();
};
