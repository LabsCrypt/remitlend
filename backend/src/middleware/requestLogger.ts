import type { Request, Response, NextFunction } from "express";
import logger from "../utils/logger.js";

/**
 * Middleware to log HTTP requests with structured fields for parsing and querying.
 * Logs method, url, statusCode, durationMs, and optional userAgent.
 */
export const requestLogger = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const start = Date.now();

  res.on("finish", () => {
    const durationMs = Date.now() - start;
    const { method, originalUrl, ip } = req;
    const userAgent = req.get("user-agent") ?? undefined;
    const { statusCode } = res;

    const payload = {
      method,
      url: originalUrl,
      statusCode,
      durationMs,
      ...(ip && { ip }),
      ...(userAgent && { userAgent }),
    };

    if (statusCode >= 500) {
      logger.error("HTTP request", payload);
    } else if (statusCode >= 400) {
      logger.warn("HTTP request", payload);
    } else {
      logger.http("HTTP request", payload);
    }
  });

  next();
};
