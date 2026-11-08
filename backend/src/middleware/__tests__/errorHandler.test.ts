import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { AppError } from '../../errors/AppError.js';
import { ErrorCode } from '../../errors/errorCodes.js';
import logger from '../../utils/logger.js';

const mockCaptureException = jest.fn<(err: unknown, hint?: unknown) => string>().mockReturnValue('mock-event-id');

await jest.unstable_mockModule('../../config/sentry.js', () => ({
  Sentry: {
    captureException: mockCaptureException,
  },
  initSentry: jest.fn(),
}));

const { errorHandler } = await import('../errorHandler.js');

describe('Global Error Handler Middleware Unit & Integration Suite (#2096)', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let loggerErrorSpy: jest.SpyInstance;

  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };

    mockReq = {
      requestId: 'req-test-uuid-1234',
      path: '/api/v1/escrow/transaction',
      method: 'POST',
    };

    mockRes = {
      status: jest.fn().mockReturnThis() as any,
      json: jest.fn().mockReturnThis() as any,
    };

    mockNext = jest.fn() as NextFunction;

    loggerErrorSpy = jest.spyOn(logger, 'error').mockImplementation(() => logger);
  });

  afterEach(() => {
    process.env = originalEnv;
    loggerErrorSpy.mockRestore();
  });

  /* ─────────────────────────────────────────────────────────────
   * 1. Operational AppError Handling (Database, Stellar & Domain)
   * ───────────────────────────────────────────────────────────── */
  describe('Operational AppError Handling', () => {
    it('maps operational AppError to expected status code and structured contract', () => {
      const err = new AppError(
        'Insufficient escrow balance',
        400,
        true,
        ErrorCode.INVALID_AMOUNT,
        'amount',
        { requested: 5000, available: 2000 }
      );

      errorHandler(err, mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: 'Insufficient escrow balance',
        field: 'amount',
        error: {
          code: ErrorCode.INVALID_AMOUNT,
          message: 'Insufficient escrow balance',
          field: 'amount',
          details: { requested: 5000, available: 2000 },
        },
      });

      // Operational errors should not trigger Sentry capture
      expect(mockCaptureException).not.toHaveBeenCalled();
    });

    it('handles Stellar blockchain operational transaction failure', () => {
      const err = new AppError(
        'Transaction rejected by Stellar Horizon network: op_underfunded',
        400,
        true,
        ErrorCode.BLOCKCHAIN_ERROR,
        'stellar_tx',
        { txHash: '5e7f1234567890abcdef', ledgerSequence: 1049281 }
      );

      errorHandler(err, mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'Transaction rejected by Stellar Horizon network: op_underfunded',
          error: expect.objectContaining({
            code: ErrorCode.BLOCKCHAIN_ERROR,
            field: 'stellar_tx',
            details: { txHash: '5e7f1234567890abcdef', ledgerSequence: 1049281 },
          }),
        })
      );
    });

    it('handles database unique constraint conflict errors (409)', () => {
      const err = new AppError(
        'Escrow payout transaction already exists',
        409,
        true,
        ErrorCode.CONFLICT,
        'escrow_id',
        { escrowId: 'ESC-999' }
      );

      errorHandler(err, mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(409);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: ErrorCode.CONFLICT,
            field: 'escrow_id',
          }),
        })
      );
    });

    it('masks message and reports to Sentry when AppError is non-operational', () => {
      const err = new AppError(
        'Critical pool liquidity invariant broken',
        500,
        false, // non-operational: programming/infrastructure bug
        ErrorCode.INTERNAL_ERROR
      );

      errorHandler(err, mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Internal AppError: Critical pool liquidity invariant broken'),
        expect.objectContaining({
          requestId: 'req-test-uuid-1234',
          path: '/api/v1/escrow/transaction',
          method: 'POST',
        })
      );
      expect(mockCaptureException).toHaveBeenCalledWith(
        err,
        expect.objectContaining({
          extra: { path: '/api/v1/escrow/transaction', method: 'POST' },
        })
      );
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: 'Internal server error',
        error: {
          code: ErrorCode.INTERNAL_ERROR,
          message: 'Internal server error',
        },
      });
    });
  });

  /* ─────────────────────────────────────────────────────────────
   * 2. Zod Validation Error Handling
   * ───────────────────────────────────────────────────────────── */
  describe('Zod Validation Error Handling', () => {
    it('maps ZodError to structured 400 format with field-level details', () => {
      const schema = z.object({
        recipient: z.string().min(5, 'String must contain at least 5 character(s)'),
        amount: z.number().positive('Number must be greater than 0'),
      });

      const parseResult = schema.safeParse({ recipient: 'abc', amount: -10 });
      expect(parseResult.success).toBe(false);

      if (!parseResult.success) {
        errorHandler(parseResult.error, mockReq as Request, mockRes as Response, mockNext);

        expect(mockRes.status).toHaveBeenCalledWith(400);
        expect(mockRes.json).toHaveBeenCalledWith({
          success: false,
          message: 'Validation failed',
          errors: [
            { path: 'recipient', message: 'String must contain at least 5 character(s)' },
            { path: 'amount', message: 'Number must be greater than 0' },
          ],
          error: {
            code: ErrorCode.VALIDATION_ERROR,
            message: 'Validation failed',
            field: 'recipient',
            details: [
              {
                field: 'recipient',
                message: 'String must contain at least 5 character(s)',
                code: 'too_small',
              },
              {
                field: 'amount',
                message: 'Number must be greater than 0',
                code: 'too_small',
              },
            ],
          },
        });
      }
    });
  });

  /* ─────────────────────────────────────────────────────────────
   * 3. Payload Too Large (entity.too.large)
   * ───────────────────────────────────────────────────────────── */
  describe('Payload Size Limit Error Handling', () => {
    it('returns 413 Payload Too Large on entity.too.large exception', () => {
      const err = new Error('request entity too large') as any;
      err.type = 'entity.too.large';

      errorHandler(err, mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(413);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: 'Request payload too large',
        error: {
          code: ErrorCode.VALIDATION_ERROR,
          message: 'Request payload too large',
        },
      });
    });
  });

  /* ─────────────────────────────────────────────────────────────
   * 4. Unhandled Database, System & Programming Exceptions
   * ───────────────────────────────────────────────────────────── */
  describe('Unhandled System & Programming Exceptions', () => {
    it('catches generic Error, logs with requestId and reports to Sentry', () => {
      const err = new Error('Postgres connection pool exhausted (ECONNREFUSED)');

      errorHandler(err, mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Unhandled error',
        expect.objectContaining({
          requestId: 'req-test-uuid-1234',
          message: 'Postgres connection pool exhausted (ECONNREFUSED)',
          name: 'Error',
        })
      );
      expect(mockCaptureException).toHaveBeenCalledWith(err);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: 'Internal server error',
        error: {
          code: ErrorCode.INTERNAL_ERROR,
          message: 'Internal server error',
        },
      });
    });

    it('exposes stack trace only when in development and EXPOSE_STACK_TRACES is true', () => {
      process.env.NODE_ENV = 'development';
      process.env.EXPOSE_STACK_TRACES = 'true';

      const err = new Error('Debuggable stack trace exception');

      errorHandler(err, mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      const jsonCall = (mockRes.json as jest.Mock).mock.calls[0][0] as any;
      expect(jsonCall.stack).toBeDefined();
      expect(jsonCall.stack).toContain('Debuggable stack trace exception');
    });

    it('omits stack trace in production environment even if EXPOSE_STACK_TRACES is set', () => {
      process.env.NODE_ENV = 'production';
      process.env.EXPOSE_STACK_TRACES = 'true';

      const err = new Error('Sensitive internal server exception');

      errorHandler(err, mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      const jsonCall = (mockRes.json as jest.Mock).mock.calls[0][0] as any;
      expect(jsonCall.stack).toBeUndefined();
    });
  });

  /* ─────────────────────────────────────────────────────────────
   * 5. Express Supertest Integration Suite
   * ───────────────────────────────────────────────────────────── */
  describe('Express Supertest Integration Flow', () => {
    let app: express.Express;

    beforeEach(() => {
      app = express();
      app.use(express.json());

      // Route simulating database conflict
      app.get('/api/test/db-conflict', () => {
        throw new AppError('Conflict on record update', 409, true, ErrorCode.CONFLICT, 'id');
      });

      // Route simulating external Stellar network timeout
      app.get('/api/test/stellar-timeout', () => {
        throw new AppError(
          'Stellar Horizon RPC timed out',
          503,
          true,
          ErrorCode.EXTERNAL_SERVICE_ERROR
        );
      });

      // Route simulating unexpected runtime crash
      app.get('/api/test/runtime-crash', () => {
        throw new Error('Unexpected undefined dereference');
      });

      app.use(errorHandler);
    });

    it('correctly maps AppError status and payload over HTTP', async () => {
      const res = await request(app).get('/api/test/db-conflict');

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('CONFLICT');
      expect(res.body.error.field).toBe('id');
    });

    it('correctly maps 503 external service timeout over HTTP', async () => {
      const res = await request(app).get('/api/test/stellar-timeout');

      expect(res.status).toBe(503);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('EXTERNAL_SERVICE_ERROR');
    });

    it('correctly catches runtime crash and returns 500 JSON without crashing process', async () => {
      const res = await request(app).get('/api/test/runtime-crash');

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
      expect(res.body.message).toBe('Internal server error');
    });
  });
});
