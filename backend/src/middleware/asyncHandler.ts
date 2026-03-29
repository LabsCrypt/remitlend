import type { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * Wraps an async Express route handler so that rejected promises are
 * automatically forwarded to the global error handling middleware via
 * `next(err)`.
 *
 * Usage:
 * ```ts
 * router.get('/resource', asyncHandler(async (req, res) => {
 *     const data = await fetchData();
 *     res.json(data);
 * }));
 * ```
 */
export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void> | void,
): RequestHandler => {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
