import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';

const mockCaptureException = jest.fn();
jest.unstable_mockModule('../../config/sentry.js', () => ({
  Sentry: { captureException: mockCaptureException },
}));

const mockLoggerError = jest.fn();
jest.unstable_mockModule('../../utils/logger.js', () => ({
  default: {
    error: mockLoggerError,
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

const { errorHandler } = await import('../errorHandler.js');
const { validateBody } = await import('../validation.js');
const { AppError } = await import('../../errors/AppError.js');
const { ErrorCode } = await import('../../errors/errorCodes.js');

const app = express();
app.use(express.json({ limit: '100kb' }));
app.post('/validated', validateBody(z.object({ publicKey: z.string() })), (_req, res) => {
  res.status(200).json({ ok: true });
});
app.post(
  '/nested-validated',
  validateBody(
    z.object({
      profile: z.object({
        email: z.string().email(),
      }),
    }),
  ),
  (_req, res) => {
    res.status(200).json({ ok: true });
  },
);
app.get('/boom', () => {
  throw new Error('unexpected failure');
});
app.get('/error/db-operational', () => {
  throw AppError.withCode(ErrorCode.DATABASE_ERROR, 'Database query failed');
});
app.get('/error/db-non-operational', () => {
  throw new AppError('Database connection pool exhausted', 500, false, ErrorCode.DATABASE_ERROR);
});
app.get('/error/stellar-op-failed', () => {
  throw AppError.withCode(
    ErrorCode.BLOCKCHAIN_ERROR,
    'Stellar transaction rejected: op_underfunded',
    undefined,
    { txHash: 'tx-123', opResult: 'op_underfunded' },
  );
});
app.get('/error/stellar-invalid-xdr', () => {
  throw AppError.withCode(
    ErrorCode.INVALID_TX_XDR,
    'Malformed transaction XDR payload',
    'signedTxXdr',
  );
});
app.get('/error/stellar-unavailable', () => {
  throw AppError.serviceUnavailable('Stellar RPC node is unreachable');
});
app.get('/error/runtime-type-error', () => {
  throw new TypeError('Cannot read properties of null (reading id)');
});
app.use(errorHandler);

describe('client input error handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('maps malformed JSON to a 400 validation error without reporting to Sentry', async () => {
    const response = await request(app)
      .post('/validated')
      .set('Content-Type', 'application/json')
      .send('{"publicKey":');

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.message).toBe('Invalid JSON request body');
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it('maps an empty body to a 400 validation error without reporting to Sentry', async () => {
    const response = await request(app)
      .post('/validated')
      .set('Content-Type', 'application/json')
      .send('');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it('keeps oversized payloads as 413 validation errors without reporting to Sentry', async () => {
    const response = await request(app)
      .post('/validated')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ publicKey: 'x'.repeat(101 * 1024) }));

    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.message).toBe('Request payload too large');
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it('still reports unexpected errors to Sentry', async () => {
    const response = await request(app).get('/boom');

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('INTERNAL_ERROR');
    expect(mockCaptureException).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe('database, stellar, validation, and unknown exception mapping', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('maps nested Zod validation errors to 400 with path and field details without Sentry', async () => {
    const response = await request(app)
      .post('/nested-validated')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ profile: { email: 'not-an-email' } }));

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toBe('Validation failed');
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.field).toBe('profile.email');
    expect(response.body.error.details[0]?.field).toBe('profile.email');
    expect(response.body.errors[0]?.path).toBe('profile.email');
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it('maps operational database errors to 500 DATABASE_ERROR without reporting to Sentry', async () => {
    const response = await request(app).get('/error/db-operational');

    expect(response.status).toBe(500);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('DATABASE_ERROR');
    expect(response.body.error.message).toBe('Database query failed');
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it('maps non-operational database errors to 500, hides internal message, and reports to Sentry', async () => {
    const response = await request(app).get('/error/db-non-operational');

    expect(response.status).toBe(500);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toBe('Internal server error');
    expect(response.body.error.code).toBe('DATABASE_ERROR');
    expect(response.body.error.message).toBe('Internal server error');
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.stringContaining('Database connection pool exhausted'),
      expect.objectContaining({ path: '/error/db-non-operational', method: 'GET' }),
    );
  });

  it('maps operational Stellar transaction failures to 500 BLOCKCHAIN_ERROR with details', async () => {
    const response = await request(app).get('/error/stellar-op-failed');

    expect(response.status).toBe(500);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('BLOCKCHAIN_ERROR');
    expect(response.body.error.message).toBe('Stellar transaction rejected: op_underfunded');
    expect(response.body.error.details).toEqual({
      txHash: 'tx-123',
      opResult: 'op_underfunded',
    });
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it('maps invalid Stellar transaction XDR to 400 INVALID_TX_XDR with field attribution', async () => {
    const response = await request(app).get('/error/stellar-invalid-xdr');

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('INVALID_TX_XDR');
    expect(response.body.error.field).toBe('signedTxXdr');
    expect(response.body.field).toBe('signedTxXdr');
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it('maps Stellar service unavailability to 503 SERVICE_UNAVAILABLE', async () => {
    const response = await request(app).get('/error/stellar-unavailable');

    expect(response.status).toBe(503);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(response.body.error.message).toBe('Stellar RPC node is unreachable');
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it('maps runtime TypeError to 500 INTERNAL_ERROR and logs and reports to Sentry', async () => {
    const response = await request(app).get('/error/runtime-type-error');

    expect(response.status).toBe(500);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('INTERNAL_ERROR');
    expect(response.body.error.message).toBe('Internal server error');
    expect(mockCaptureException).toHaveBeenCalledWith(expect.any(TypeError));
    expect(mockLoggerError).toHaveBeenCalledWith(
      'Unhandled error',
      expect.objectContaining({
        message: expect.stringContaining('Cannot read properties of null'),
      }),
    );
  });
});
