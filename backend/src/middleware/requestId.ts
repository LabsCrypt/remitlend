import type { Request, Response, NextFunction } from 'express';
import { createRequestId, runWithRequestContext } from '../utils/requestContext.js';

declare module 'express' {
  interface Request {
    requestId?: string;
  }
}

export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const incomingHeader = req.header('x-request-id');
  // ID generation strategy (#1522): createRequestId() (see
  // ../utils/requestContext.ts) delegates to Node's crypto.randomUUID(),
  // a cryptographically-random RFC 4122 v4 UUID drawn from the OS CSPRNG
  // on every call. Each call is independent — there is no shared counter,
  // timestamp, or other mutable state to coordinate across concurrent
  // requests — so uniqueness holds under concurrency by construction, not
  // by locking or sequencing. The collision probability across billions
  // of generated IDs remains astronomically small (~2^-122 birthday bound
  // per pair). See __tests__/requestId.test.ts for empirical concurrent
  // uniqueness coverage.
  const requestId =
    typeof incomingHeader === 'string' && incomingHeader.trim().length > 0
      ? incomingHeader.trim()
      : createRequestId();

  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);

  runWithRequestContext(requestId, () => {
    next();
  });
};
