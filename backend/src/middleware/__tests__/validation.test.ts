import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import {
  validateBody,
  validateQuery,
  validateParams,
  validate,
  createSchema,
} from '../validation.js';
import { errorHandler } from '../errorHandler.js';
import { ErrorCode } from '../../errors/errorCodes.js';

describe('Validation Middleware Unit & Integration Suite (#2095)', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockReq = {
      body: {},
      query: {},
      params: {},
    };
    mockRes = {};
    mockNext = jest.fn() as NextFunction;
  });

  /* ─────────────────────────────────────────────────────────────
   * 1. validateBody Unit Tests
   * ───────────────────────────────────────────────────────────── */
  describe('validateBody', () => {
    const userSchema = z.object({
      name: z.string().min(1),
      age: z.number().int().positive(),
      nested: z.object({
        accountNumber: z.string().min(5),
        details: z.object({
          verified: z.boolean(),
        }),
      }),
      tags: z.array(z.string().min(2)),
    });

    it('invokes next() without arguments on valid body payload', () => {
      mockReq.body = {
        name: 'Alice',
        age: 30,
        nested: {
          accountNumber: 'ACC-12345',
          details: { verified: true },
        },
        tags: ['remittance', 'stellar'],
      };

      const middleware = validateBody(userSchema);
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
      expect(mockNext).toHaveBeenCalledTimes(1);
    });

    it('passes ZodError to next(error) on missing required fields', () => {
      mockReq.body = {
        age: 30,
      };

      const middleware = validateBody(userSchema);
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
      const passedError = (mockNext as jest.Mock).mock.calls[0][0];
      expect(passedError).toBeInstanceOf(z.ZodError);
      expect((passedError as z.ZodError).issues.some((i) => i.path.includes('name'))).toBe(true);
      expect((passedError as z.ZodError).issues.some((i) => i.path.includes('nested'))).toBe(true);
    });

    it('correctly captures deeply nested schema error paths', () => {
      mockReq.body = {
        name: 'Alice',
        age: 30,
        nested: {
          accountNumber: 'ACC-12345',
          details: { verified: 'not-a-boolean' },
        },
        tags: ['remittance'],
      };

      const middleware = validateBody(userSchema);
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
      const passedError = (mockNext as jest.Mock).mock.calls[0][0] as z.ZodError;
      expect(passedError).toBeInstanceOf(z.ZodError);
      const detail = passedError.issues.find(
        (i) => i.path.join('.') === 'nested.details.verified'
      );
      expect(detail).toBeDefined();
    });

    it('captures indexed array element error paths in nested payloads', () => {
      mockReq.body = {
        name: 'Alice',
        age: 30,
        nested: {
          accountNumber: 'ACC-12345',
          details: { verified: true },
        },
        tags: ['ok', 'x'], // 'x' violates min(2)
      };

      const middleware = validateBody(userSchema);
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
      const passedError = (mockNext as jest.Mock).mock.calls[0][0] as z.ZodError;
      expect(passedError).toBeInstanceOf(z.ZodError);
      const tagIssue = passedError.issues.find((i) => i.path.join('.') === 'tags.1');
      expect(tagIssue).toBeDefined();
    });

    it('handles empty body boundary condition safely', () => {
      mockReq.body = undefined;

      const middleware = validateBody(userSchema);
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
      const passedError = (mockNext as jest.Mock).mock.calls[0][0];
      expect(passedError).toBeInstanceOf(z.ZodError);
    });
  });

  /* ─────────────────────────────────────────────────────────────
   * 2. validateQuery Unit Tests
   * ───────────────────────────────────────────────────────────── */
  describe('validateQuery', () => {
    const querySchema = z.object({
      page: z.string().regex(/^\d+$/),
      limit: z.string().regex(/^\d+$/),
      filter: z.enum(['pending', 'active', 'completed']).optional(),
    });

    it('invokes next() on valid query parameters', () => {
      mockReq.query = { page: '1', limit: '25', filter: 'active' };

      const middleware = validateQuery(querySchema);
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
      expect(mockNext).toHaveBeenCalledTimes(1);
    });

    it('passes ZodError to next() on invalid enum query value', () => {
      mockReq.query = { page: '1', limit: '25', filter: 'unknown_filter' };

      const middleware = validateQuery(querySchema);
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
      const passedError = (mockNext as jest.Mock).mock.calls[0][0] as z.ZodError;
      expect(passedError).toBeInstanceOf(z.ZodError);
      expect(passedError.issues[0].path).toEqual(['filter']);
    });
  });

  /* ─────────────────────────────────────────────────────────────
   * 3. validateParams Unit Tests
   * ───────────────────────────────────────────────────────────── */
  describe('validateParams', () => {
    const paramsSchema = z.object({
      loanId: z.string().uuid(),
    });

    it('invokes next() on valid UUID parameter', () => {
      mockReq.params = { loanId: '123e4567-e89b-12d3-a456-426614174000' };

      const middleware = validateParams(paramsSchema);
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('passes ZodError to next() on non-UUID parameter', () => {
      mockReq.params = { loanId: 'not-a-valid-uuid' };

      const middleware = validateParams(paramsSchema);
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
      const passedError = (mockNext as jest.Mock).mock.calls[0][0] as z.ZodError;
      expect(passedError).toBeInstanceOf(z.ZodError);
      expect(passedError.issues[0].path).toEqual(['loanId']);
    });
  });

  /* ─────────────────────────────────────────────────────────────
   * 4. validate Combined Schema & createSchema Helpers
   * ───────────────────────────────────────────────────────────── */
  describe('validate & createSchema helpers', () => {
    const combinedSchema = z.object({
      body: z.object({
        amount: z.number().positive(),
      }),
      query: z.object({
        currency: z.string().length(3),
      }),
      params: z.object({
        userId: z.string().min(1),
      }),
    });

    it('invokes next() when body, query, and params all satisfy schema', () => {
      mockReq.body = { amount: 150 };
      mockReq.query = { currency: 'USD' };
      mockReq.params = { userId: 'usr-987' };

      const middleware = validate(combinedSchema);
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('passes ZodError indicating specific sub-object when validation fails', () => {
      mockReq.body = { amount: -50 }; // invalid: non-positive
      mockReq.query = { currency: 'USD' };
      mockReq.params = { userId: 'usr-987' };

      const middleware = validate(combinedSchema);
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
      const passedError = (mockNext as jest.Mock).mock.calls[0][0] as z.ZodError;
      expect(passedError).toBeInstanceOf(z.ZodError);
      expect(passedError.issues[0].path).toEqual(['body', 'amount']);
    });

    it('verifies createSchema helpers format objects with expected top-level keys', () => {
      const innerBody = z.object({ x: z.number() });
      const schemaBody = createSchema.body(innerBody);
      expect(schemaBody.safeParse({ body: { x: 10 } }).success).toBe(true);
      expect(schemaBody.safeParse({ body: { x: 'invalid' } }).success).toBe(false);

      const innerQuery = z.object({ q: z.string() });
      const schemaQuery = createSchema.query(innerQuery);
      expect(schemaQuery.safeParse({ query: { q: 'search' } }).success).toBe(true);

      const innerParams = z.object({ id: z.string() });
      const schemaParams = createSchema.params(innerParams);
      expect(schemaParams.safeParse({ params: { id: 'item-1' } }).success).toBe(true);
    });
  });

  /* ─────────────────────────────────────────────────────────────
   * 5. Integration with errorHandler (Consistent 400 Response Shape)
   * ───────────────────────────────────────────────────────────── */
  describe('End-to-End Express Integration with errorHandler', () => {
    let testApp: express.Express;

    beforeEach(() => {
      testApp = express();
      testApp.use(express.json());

      const transferSchema = z.object({
        amount: z.number().positive(),
        recipient: z.object({
          address: z.string().min(10, 'Address must have at least 10 characters'),
          metadata: z.object({
            countryCode: z.string().length(2, 'Must be 2-letter ISO code'),
          }),
        }),
      });

      testApp.post(
        '/api/test-transfer',
        validateBody(transferSchema),
        (_req: Request, res: Response) => {
          res.status(200).json({ success: true });
        }
      );

      // Attach centralized errorHandler
      testApp.use(errorHandler);
    });

    it('returns 200 OK when request body conforms to nested schema', async () => {
      const res = await request(testApp)
        .post('/api/test-transfer')
        .send({
          amount: 500,
          recipient: {
            address: 'GAXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
            metadata: { countryCode: 'US' },
          },
        });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
    });

    it('returns consistent structured 400 response shape on nested schema failure', async () => {
      const res = await request(testApp)
        .post('/api/test-transfer')
        .send({
          amount: 500,
          recipient: {
            address: 'short', // violates min(10)
            metadata: { countryCode: 'USA' }, // violates length(2)
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Validation failed');

      // Legacy errors contract verification
      expect(Array.isArray(res.body.errors)).toBe(true);
      expect(res.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: 'recipient.address',
            message: 'Address must have at least 10 characters',
          }),
          expect.objectContaining({
            path: 'recipient.metadata.countryCode',
            message: 'Must be 2-letter ISO code',
          }),
        ])
      );

      // Structured error contract verification
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(res.body.error.message).toBe('Validation failed');
      expect(res.body.error.field).toBe('recipient.address'); // First failing field
      expect(Array.isArray(res.body.error.details)).toBe(true);
      expect(res.body.error.details.length).toBe(2);

      expect(res.body.error.details[0]).toMatchObject({
        field: 'recipient.address',
        message: 'Address must have at least 10 characters',
      });
      expect(res.body.error.details[1]).toMatchObject({
        field: 'recipient.metadata.countryCode',
        message: 'Must be 2-letter ISO code',
      });
    });

    it('returns structured 400 response on completely empty payload', async () => {
      const res = await request(testApp)
        .post('/api/test-transfer')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(res.body.error.field).toBe('amount');
      expect(res.body.errors.length).toBeGreaterThanOrEqual(2);
    });
  });
});
