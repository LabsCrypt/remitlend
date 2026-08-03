import type { Request, Response, NextFunction, RequestHandler } from 'express';

function normalizeError(err: unknown): Error {
  if (err instanceof Error) return err;
  const error = new Error(`Non-Error rejection: ${String(err)}`);
  (error as Error & { cause?: unknown }).cause = err;
  return error;
}

export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void> | void,
): RequestHandler => {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch((err) => next(normalizeError(err)));
  };
};
