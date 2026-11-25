import { describe, it, expect, jest } from '@jest/globals';
import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { z } from 'zod';
import { borrowerLoansQuerySchema } from '../../schemas/loanSchemas.js';
import {
  validateBody,
  validateParams,
  validateQuery,
  validate,
  createSchema,
} from '../validation.js';

jest.unstable_mockModule('../../config/sentry.js', () => ({
  Sentry: { captureException: jest.fn() },
}));

jest.unstable_mockModule('../../utils/logger.js', () => ({
  default: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    http: jest.fn(),
  },
}));

const { errorHandler } = await import('../errorHandler.js');

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

const contractApp = express();
contractApp.use(express.json());

const nestedBodySchema = z.object({
  recipient: z.object({
    email: z.string().email(),
    phone: z.string().min(10),
  }),
  amount: z.coerce.number().positive().max(1000),
});

contractApp.post('/nested', validateBody(nestedBodySchema), (req, res) => {
  res.json({ body: req.body });
});

contractApp.get(
  '/sources/:id',
  validate(
    z.object({
      params: z.object({ id: z.coerce.number().int().positive() }),
      query: z.object({ page: z.coerce.number().int().min(1) }),
    }),
  ),
  (req, res) => {
    res.json({ id: req.params.id, page: req.query.page });
  },
);

contractApp.get('/borrower-cursor', validateQuery(borrowerLoansQuerySchema), (req, res) => {
  res.json({ cursor: req.query.cursor ?? null });
});

contractApp.use(errorHandler);

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

describe('validation middleware error contract (#2095)', () => {
  it('returns the parsed nested body on the success path', async () => {
    const response = await request(contractApp)
      .post('/nested')
      .send({
        recipient: { email: 'recipient@example.com', phone: '+14155550123' },
        amount: '25.50',
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      body: {
        recipient: { email: 'recipient@example.com', phone: '+14155550123' },
        amount: 25.5,
      },
    });
  });

  it('reports every nested schema failure with dotted paths and a 400 shape', async () => {
    const response = await request(contractApp)
      .post('/nested')
      .send({
        recipient: { email: 'not-an-email', phone: '123' },
        amount: -1,
      });

    expect(response.status).toBe(400);
    expect(Object.keys(response.body).sort()).toEqual(['error', 'errors', 'message', 'success']);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toBe('Validation failed');
    expect(response.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      field: 'recipient.email',
    });

    const paths = response.body.error.details.map((detail: { field: string }) => detail.field);
    expect(paths).toEqual(expect.arrayContaining(['recipient.email', 'recipient.phone', 'amount']));
    expect(response.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'recipient.email' }),
        expect.objectContaining({ path: 'recipient.phone' }),
        expect.objectContaining({ path: 'amount' }),
      ]),
    );
    for (const detail of response.body.error.details) {
      expect(detail).toEqual(
        expect.objectContaining({ field: expect.any(String), code: expect.any(String) }),
      );
      expect(detail.message).toEqual(expect.any(String));
    }
  });

  it('uses the same 400 contract for combined query and params validation', async () => {
    const response = await request(contractApp).get('/sources/not-a-number?page=0');

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details.map((detail: { field: string }) => detail.field)).toEqual(
      expect.arrayContaining(['params.id', 'query.page']),
    );
  });

  it('does not echo authorization secrets in validation failures', async () => {
    const authorization = 'Bearer super-secret-token-value';
    const response = await request(contractApp)
      .post('/nested')
      .set('Authorization', authorization)
      .send({ recipient: {}, amount: 10 });

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).not.toContain('super-secret-token-value');
  });
});

describe('borrower loans cursor validation (#2231)', () => {
  it.each(['abc', '12abc', '0', '-1', '', '2147483648', '1.5', ' 12', '12 '])(
    'rejects invalid cursor %j with the standard 400 error contract',
    async (cursor) => {
      const response = await request(contractApp).get('/borrower-cursor').query({ cursor });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        success: false,
        message: 'Validation failed',
        error: { code: 'VALIDATION_ERROR', field: 'cursor' },
      });
      expect(response.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'cursor' })]),
      );
    },
  );

  it('accepts a valid cursor without changing its decimal representation', async () => {
    const response = await request(contractApp).get('/borrower-cursor?cursor=12');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ cursor: '12' });
  });

  it('allows a request without a cursor for the first page', async () => {
    const response = await request(contractApp).get('/borrower-cursor');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ cursor: null });
  });

  it('accepts the maximum PostgreSQL int4 cursor', async () => {
    const response = await request(contractApp).get('/borrower-cursor?cursor=2147483647');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ cursor: '2147483647' });
  });
});
