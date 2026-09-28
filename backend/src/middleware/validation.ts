import type { Request, Response, NextFunction } from 'express';
import { z, type ZodSchema, type ZodType } from 'zod';

type ValidationSource = 'body' | 'query' | 'params';

/**
 * Assigns parsed and transformed data back onto the Express request object.
 *
 * In Express 5, `req.query` is defined via a getter on the request prototype.
 * Using `Object.defineProperty` ensures the coerced/transformed parsed values
 * cleanly overwrite raw query params, params, or body and remain writable for downstream
 * handlers (#1862).
 */
const assignParsedData = (req: Request, source: ValidationSource, data: unknown): void => {
  try {
    req[source] = data as any;
  } catch {
    // In Express 5, direct property assignment on req.query throws or is ignored due to prototype getter
  }
  Object.defineProperty(req, source, {
    value: data,
    writable: true,
    configurable: true,
    enumerable: true,
  });
};

const validateSource = (schema: ZodType, source: ValidationSource) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const data = source === 'body' ? req.body : source === 'query' ? req.query : req.params;
      const parsed = schema.parse(data);
      assignParsedData(req, source, parsed);
      next();
    } catch (error) {
      next(error);
    }
  };
};

export const validateBody = (schema: ZodType) => validateSource(schema, 'body');
export const validateQuery = (schema: ZodType) => validateSource(schema, 'query');
export const validateParams = (schema: ZodType) => validateSource(schema, 'params');

export const validate = (schema: ZodSchema) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const parsed = schema.parse({
        body: req.body,
        query: req.query,
        params: req.params,
      }) as { body?: unknown; query?: unknown; params?: unknown };

      if (parsed && typeof parsed === 'object') {
        if ('body' in parsed && parsed.body !== undefined) {
          assignParsedData(req, 'body', parsed.body);
        }
        if ('query' in parsed && parsed.query !== undefined) {
          assignParsedData(req, 'query', parsed.query);
        }
        if ('params' in parsed && parsed.params !== undefined) {
          assignParsedData(req, 'params', parsed.params);
        }
      }
      next();
    } catch (error) {
      next(error);
    }
  };
};

export const createSchema = {
  body: <T extends ZodType>(schema: T) => z.object({ body: schema }),
  query: <T extends ZodType>(schema: T) => z.object({ query: schema }),
  params: <T extends ZodType>(schema: T) => z.object({ params: schema }),
};
