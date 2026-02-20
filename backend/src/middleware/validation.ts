import type { Request, Response, NextFunction } from 'express';
import { z, type ZodSchema } from 'zod';

export const validate = (schema: ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      schema.parse({
        body: req.body,
        query: req.query,
        params: req.params
      });
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: error.issues.map((err: z.ZodIssue) => ({
            path: err.path.join('.'),
            message: err.message
          }))
        });
      } else {
        res.status(500).json({
          success: false,
          message: 'Internal server error'
        });
      }
    }
  };
};