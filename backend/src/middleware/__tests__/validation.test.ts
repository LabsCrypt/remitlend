import { describe, it, expect } from '@jest/globals';
import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { z } from 'zod';
import {
  validateBody,
  validateParams,
  validateQuery,
  validate,
  createSchema,
} from '../validation.js';

const app = express();
app.use(express.json());

app.get(
  '/params/:loanId',
  validateParams(z.object({ loanId: z.coerce.number().int() })),
  (req, res) => {
    res.json({ value: req.params.loanId, type: typeof req.params.loanId });
  },
);

app.post(
  '/body',
  validateBody(z.object({ amount: z.coerce.number(), note: z.string().default('none') })),
  (req, res) => {
    res.json({ body: req.body, amountType: typeof req.body.amount });
  },
);

app.get(
  '/query',
  validateQuery(z.object({ page: z.coerce.number().int().default(1) })),
  (req, res) => {
    res.json({ page: req.query.page, pageType: typeof req.query.page });
  },
);

app.get(
  '/combined/:loanId',
  validate(createSchema.params(z.object({ loanId: z.coerce.number().int() }))),
  (req, res) => {
    res.json({ value: req.params.loanId, type: typeof req.params.loanId });
  },
);

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  res.status(400).json({ message: err instanceof Error ? err.message : 'validation failed' });
});

describe('validation middleware parsed output', () => {
  it('writes coerced params back so handlers receive a number', async () => {
    const response = await request(app).get('/params/42');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ value: 42, type: 'number' });
  });

  it('writes coerced and defaulted body output back', async () => {
    const response = await request(app).post('/body').send({ amount: '17' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      body: { amount: 17, note: 'none' },
      amountType: 'number',
    });
  });

  it('writes parsed query output back despite the Express 5 query getter', async () => {
    const response = await request(app).get('/query').query({ page: '3' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ page: 3, pageType: 'number' });
  });

  it('writes parsed output back when validating all request sources together', async () => {
    const response = await request(app).get('/combined/99');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ value: 99, type: 'number' });
  });
});
