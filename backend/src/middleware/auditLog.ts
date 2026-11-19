import type { Request, Response, NextFunction } from 'express';
import { query } from '../db/connection.js';
import logger from '../utils/logger.js';

const AUDIT_LOG_TIMEOUT_MS = Number(process.env.AUDIT_LOG_TIMEOUT_MS ?? 750);

type PersistAuditLog = (
  actor: string,
  action: string,
  target: string | undefined,
  payload: unknown,
  ipAddress: string | undefined,
  statusCode: number,
) => Promise<void>;

type AuditLogger = Pick<typeof logger, 'error' | 'warn'>;

export interface AuditLogDependencies {
  persistAuditLog?: PersistAuditLog;
  logger?: AuditLogger;
}

async function persistAuditLog(
  actor: string,
  action: string,
  target: string | undefined,
  payload: unknown,
  ipAddress: string | undefined,
  statusCode: number,
): Promise<void> {
  let timeout: NodeJS.Timeout | undefined;

  try {
    await Promise.race([
      query(
        `INSERT INTO audit_logs (actor, action, target, payload, ip_address, status)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          actor,
          action,
          target ?? null,
          payload ? JSON.stringify(payload) : null,
          ipAddress ?? null,
          statusCode,
        ],
      ),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`Audit log insert timed out after ${AUDIT_LOG_TIMEOUT_MS}ms`));
        }, AUDIT_LOG_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

/**
 * Sanitizes the request body to remove sensitive fields before logging.
 */
function sanitizePayload(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body;

  if (Array.isArray(body)) {
    return body.map(sanitizePayload);
  }

  const sanitized = { ...body } as Record<string, unknown>;
  const sensitiveFields = [
    'secret',
    'apiKey',
    'password',
    'token',
    'signedTx',
    'signedTxXdr',
    'x-api-key',
  ];

  for (const key of Object.keys(sanitized)) {
    if (sensitiveFields.includes(key)) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
      sanitized[key] = sanitizePayload(sanitized[key]);
    }
  }

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
  const body = req.body as Record<string, unknown>;
  if (body) {
    if (body.loanId) return `LoanID:${body.loanId}`;
    if (Array.isArray(body.loanIds)) return `LoanIDs:[${body.loanIds.join(',')}]`;
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
export const createAuditLogMiddleware = (dependencies: AuditLogDependencies = {}) => {
  const persist = dependencies.persistAuditLog ?? persistAuditLog;
  const auditLogger = dependencies.logger ?? logger;

  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const actor =
        req.user?.publicKey ?? (req.headers['x-api-key'] ? 'INTERNAL_API_KEY' : 'unknown');
      const action = `${req.method} ${req.path}`;
      const target = extractTarget(req);
      const payload = sanitizePayload(req.body);
      const ipAddress =
        req.ip ||
        (Array.isArray(req.headers['x-forwarded-for'])
          ? req.headers['x-forwarded-for'][0]
          : (req.headers['x-forwarded-for'] as string)
        )?.split(',')[0] ||
        req.socket.remoteAddress;

      res.on('finish', () => {
        void persist(actor, action, target, payload, ipAddress, res.statusCode).catch((err) => {
          auditLogger.error('Audit logging failure', {
            err,
            actor,
            action,
            target,
          });
        });
      });
    } catch (err) {
      auditLogger.warn('Audit log middleware error', { err });
    }

    next();
  };
};

export const auditLog = createAuditLogMiddleware();
