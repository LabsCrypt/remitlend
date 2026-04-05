import type { Request, Response, NextFunction, RequestHandler } from "express";

export const asyncHandler = (
    fn: (req: Request, res: Response, next: NextFunction) => Promise<void> | void,
): RequestHandler => {
    return (req: Request, res: Response, next: NextFunction): void => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
};
