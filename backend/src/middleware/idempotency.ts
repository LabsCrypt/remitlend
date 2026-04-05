import type { Request, Response, NextFunction } from "express";
import { cacheService } from "../services/cacheService.js";
import logger from "../utils/logger.js";

const IDEMPOTENCY_TTL = 24 * 60 * 60; // 24 hours in seconds

interface CachedResponse {
  status: number;
  body: any;
}

/**
 * Middleware to handle Idempotency-Key headers.
 * If the key is present and a cached response exists, it returns the cached response.
 * Otherwise, it intercepts the response, captures it, and stores it in Redis.
 */
export const idempotencyMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const key = req.header("Idempotency-Key");

  if (!key) {
    return next();
  }

  try {
    const cacheKey = `idemp:${key}`;
    const cached = await cacheService.get<CachedResponse>(cacheKey);

    if (cached) {
      logger.info(`Idempotency hit for key: ${key}`, {
        url: req.originalUrl,
        method: req.method,
      });

      res
        .status(cached.status)
        .set("X-Idempotency-Cache", "HIT")
        .json(cached.body);
      return;
    }

    // Capture the original methods to intercept the response body
    const originalJson = res.json;
    const originalSend = res.send;

    let responseBody: any;

    // Override res.json
    res.json = function (body: any) {
      responseBody = body;
      return originalJson.call(this, body);
    };

    // Override res.send (as res.json eventually calls res.send)
    res.send = function (body: any) {
      if (!responseBody) {
        if (typeof body === "string") {
          try {
            responseBody = JSON.parse(body);
          } catch {
            responseBody = body;
          }
        } else {
          responseBody = body;
        }
      }
      return originalSend.call(this, body);
    };

    // Store the response in cache once the request is finished
    res.on("finish", async () => {
      // Only cache 2xx and 4xx status codes.
      // 5xx errors should usually be retried without returning a cached failure.
      if (res.statusCode >= 200 && res.statusCode < 500 && responseBody) {
        try {
          await cacheService.set(
            cacheKey,
            {
              status: res.statusCode,
              body: responseBody,
            },
            IDEMPOTENCY_TTL,
          );
        } catch (error) {
          logger.error(`Error caching idempotency key ${key}`, { error });
        }
      }
    });

    next();
  } catch (error) {
    logger.error("Error in idempotency middleware", { error, key });
    next();
  }
};
