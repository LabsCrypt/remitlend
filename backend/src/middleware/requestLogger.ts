import type { Request, Response, NextFunction } from 'express';
import logger, { REDACTED_FIELDS, REDACTED_VALUE } from '../utils/logger.js';

const SENSITIVE_QUERY_KEYS = new Set(
  REDACTED_FIELDS.map((field) => field.toLowerCase().replace(/[-_]/g, '')),
);

/** Redacts sensitive query parameter values that would otherwise leak through `originalUrl`. */
export const sanitizeRequestUrl = (url: string): string => {
  const queryStart = url.indexOf('?');
  if (queryStart === -1) return url;

  const path = url.slice(0, queryStart);
  const query = url.slice(queryStart + 1);
  const params = new URLSearchParams(query);

  for (const key of new Set(params.keys())) {
    if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase().replace(/[-_]/g, ''))) {
      params.set(key, REDACTED_VALUE);
    }
  }

  return `${path}?${params.toString()}`;
};

/**
 * Middleware to log HTTP requests with structured fields for parsing and querying.
 * Logs method, url, statusCode, durationMs, and optional userAgent.
 */
export const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
  const start = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const { method, originalUrl, ip } = req;
    const userAgent = req.get('user-agent') ?? undefined;
    const { statusCode } = res;

    const payload = {
      requestId: (req as Request & { requestId?: string }).requestId,
      method,
      url: sanitizeRequestUrl(originalUrl),
      statusCode,
      durationMs,
      ...(ip && { ip }),
      ...(userAgent && { userAgent }),
    };

    if (statusCode >= 500) {
      logger.error('HTTP request', payload);
    } else if (statusCode >= 400) {
      logger.warn('HTTP request', payload);
    } else {
      logger.http('HTTP request', payload);
    }
  });

  next();
};
