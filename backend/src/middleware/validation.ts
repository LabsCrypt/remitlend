import type { Request, Response, NextFunction } from "express";
import { z, type ZodSchema, type ZodType } from "zod";

type ValidationSource = "body" | "query" | "params";

const validateSource = (schema: ZodType, source: ValidationSource) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const data =
        source === "body"
          ? req.body
          : source === "query"
            ? req.query
            : req.params;
      req[source] = schema.parse(data);
      next();
    } catch (error) {
      next(error);
    }
  };
};

export const validateBody = (schema: ZodType) => validateSource(schema, "body");
export const validateQuery = (schema: ZodType) =>
  validateSource(schema, "query");
export const validateParams = (schema: ZodType) =>
  validateSource(schema, "params");

export const validate = (schema: ZodSchema) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      schema.parse({
        body: req.body,
        query: req.query,
        params: req.params,
      });
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
