import type { Request, Response, NextFunction } from "express";
import logger from "../utils/logger.js";

/**
 * Middleware to log incoming HTTP requests and their completion.
 */
export const requestLogger = (
    req: Request,
    res: Response,
    next: NextFunction,
): void => {
    const start = Date.now();

    // Log the request when it finishes
    res.on("finish", () => {
        const duration = Date.now() - start;
        const { method, originalUrl } = req;
        const { statusCode } = res;

        const message = `${method} ${originalUrl} ${statusCode} - ${duration}ms`;

        if (statusCode >= 500) {
            logger.error(message);
        } else if (statusCode >= 400) {
            logger.warn(message);
        } else {
            logger.http(message);
        }
    });

    next();
};
