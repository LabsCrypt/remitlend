import { describe, it, expect } from '@jest/globals';
import express, { type Request, type Response } from 'express';
import request from 'supertest';
import { z } from 'zod';
import { validate, validateBody, validateQuery, validateParams } from '../validation.js';

describe('Validation Middleware (#1862)', () => {
  describe('validateBody', () => {
    it('mutates req.body with coerced, transformed, and default values', async () => {
      const bodySchema = z.object({
        amount: z.coerce.number(),
        note: z.string().trim().toLowerCase(),
        status: z.string().default('PENDING'),
      });

      const app = express();
      app.use(express.json());
      app.post('/test', validateBody(bodySchema), (req: Request, res: Response) => {
        res.json({
          body: req.body,
          amountType: typeof req.body.amount,
        });
      });

      const res = await request(app).post('/test').send({
        amount: '150.5',
        note: '  HELLO WORLD  ',
      });

      expect(res.status).toBe(200);
      expect(res.body.amountType).toBe('number');
      expect(res.body.body).toEqual({
        amount: 150.5,
        note: 'hello world',
        status: 'PENDING',
      });
    });

    it('forwards error to next() on validation failure', async () => {
      const bodySchema = z.object({
        amount: z.number().positive(),
      });

      const app = express();
      app.use(express.json());
      app.post('/test', validateBody(bodySchema), (req: Request, res: Response) => {
        res.sendStatus(200);
      });

      const res = await request(app).post('/test').send({ amount: -10 });

      expect(res.status).toBe(500); // Standard express unhandled error status
    });
  });

  describe('validateQuery', () => {
    it('mutates req.query with coerced, transformed, and default values', async () => {
      const querySchema = z.object({
        limit: z
          .string()
          .transform((v) => Math.min(parseInt(v, 10), 100))
          .pipe(z.number())
          .default(20),
        page: z.coerce.number().default(1),
        active: z.coerce.boolean().default(false),
      });

      const app = express();
      app.get('/test', validateQuery(querySchema), (req: Request, res: Response) => {
        res.json({
          query: req.query,
          limitType: typeof req.query.limit,
          pageType: typeof req.query.page,
        });
      });

      // 1. With explicit values
      const res1 = await request(app).get('/test?limit=500&page=3&active=true');
      expect(res1.status).toBe(200);
      expect(res1.body.limitType).toBe('number');
      expect(res1.body.pageType).toBe('number');
      expect(res1.body.query).toEqual({
        limit: 100, // Clamped by transform
        page: 3,
        active: true,
      });

      // 2. With defaults when query is omitted
      const res2 = await request(app).get('/test');
      expect(res2.status).toBe(200);
      expect(res2.body.limitType).toBe('number');
      expect(res2.body.query).toEqual({
        limit: 20,
        page: 1,
        active: false,
      });
    });
  });

  describe('validateParams', () => {
    it('mutates req.params with coerced and transformed values', async () => {
      const paramsSchema = z.object({
        loanId: z.coerce.number().int().positive(),
        slug: z.string().transform((s) => s.toLowerCase()),
      });

      const app = express();
      app.get(
        '/loans/:loanId/:slug',
        validateParams(paramsSchema),
        (req: Request, res: Response) => {
          res.json({
            params: req.params,
            loanIdType: typeof req.params.loanId,
          });
        },
      );

      const res = await request(app).get('/loans/42/MY-LOAN-SLUG');
      expect(res.status).toBe(200);
      expect(res.body.loanIdType).toBe('number');
      expect(res.body.params).toEqual({
        loanId: 42,
        slug: 'my-loan-slug',
      });
    });
  });

  describe('validate (composite schema)', () => {
    it('mutates req.body, req.query, and req.params simultaneously', async () => {
      const compositeSchema = z.object({
        params: z.object({
          id: z.coerce.number(),
        }),
        query: z.object({
          limit: z.coerce.number().default(10),
        }),
        body: z.object({
          title: z.string().trim(),
        }),
      });

      const app = express();
      app.use(express.json());
      app.post('/items/:id', validate(compositeSchema), (req: Request, res: Response) => {
        res.json({
          params: req.params,
          query: req.query,
          body: req.body,
        });
      });

      const res = await request(app)
        .post('/items/99?limit=25')
        .send({ title: '   Sample Item   ' });

      expect(res.status).toBe(200);
      expect(res.body.params).toEqual({ id: 99 });
      expect(res.body.query).toEqual({ limit: 25 });
      expect(res.body.body).toEqual({ title: 'Sample Item' });
    });

    it('does not overwrite unconfigured request sources', async () => {
      const queryOnlySchema = z.object({
        query: z.object({
          filter: z.string().default('all'),
        }),
      });

      const app = express();
      app.use(express.json());
      app.post('/test/:routeParam', validate(queryOnlySchema), (req: Request, res: Response) => {
        res.json({
          params: req.params,
          query: req.query,
          body: req.body,
        });
      });

      const res = await request(app).post('/test/my-param').send({ existingBody: true });

      expect(res.status).toBe(200);
      expect(res.body.params).toEqual({ routeParam: 'my-param' });
      expect(res.body.body).toEqual({ existingBody: true });
      expect(res.body.query).toEqual({ filter: 'all' });
    });
  });
});
