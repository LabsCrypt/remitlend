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

const app = express();
app.use(express.json({ limit: '100kb' }));
app.post('/validated', validateBody(z.object({ publicKey: z.string() })), (_req, res) => {
  res.status(200).json({ ok: true });
});
app.get('/boom', () => {
  throw new Error('unexpected failure');
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
