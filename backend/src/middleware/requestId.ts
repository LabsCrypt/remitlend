import type { Request, Response, NextFunction } from 'express';
import { createRequestId, runWithRequestContext } from '../utils/requestContext.js';

declare module 'express' {
  interface Request {
    requestId?: string;
  }
}

export const MAX_REQUEST_ID_LENGTH = 64;
export const REQUEST_ID_REGEX = /^[a-zA-Z0-9_.-]{1,64}$/;

export function isValidRequestId(header: unknown): header is string {
  if (typeof header !== 'string') return false;
  const trimmed = header.trim();
  return (
    trimmed.length > 0 && trimmed.length <= MAX_REQUEST_ID_LENGTH && REQUEST_ID_REGEX.test(trimmed)
  );
}

export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const incomingHeader = req.header('x-request-id');
  // ID generation strategy (#1522, #1872):
  // Validate incoming client x-request-id headers against a length cap (64 chars)
  // and an allowed character set ([a-zA-Z0-9_.-]) to prevent log injection and
  // unbounded storage consumption. Any missing, malformed, or oversized header
  // falls back to a cryptographically random RFC 4122 v4 UUID from createRequestId().
  const requestId = isValidRequestId(incomingHeader) ? incomingHeader.trim() : createRequestId();

  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);

  runWithRequestContext(requestId, () => {
    next();
  });
};
