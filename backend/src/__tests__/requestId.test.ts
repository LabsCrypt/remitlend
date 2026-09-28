import request from 'supertest';
import logger from '../utils/logger.js';
import { jest, describe, it, expect } from '@jest/globals';
import express from 'express';
import {
  requestIdMiddleware,
  isValidRequestId,
  MAX_REQUEST_ID_LENGTH,
} from '../middleware/requestId.js';

describe('Request ID middleware', () => {
  const createTestApp = () => {
    const testApp = express();
    testApp.use(requestIdMiddleware);
    testApp.get('/', (_req, res) => res.sendStatus(200));
    return testApp;
  };

  it('adds x-request-id when missing', async () => {
    const testApp = createTestApp();
    const response = await request(testApp).get('/');
    const requestId = response.headers['x-request-id'] as string | undefined;

    expect(response.status).toBe(200);
    expect(requestId).toBeDefined();
    expect(typeof requestId).toBe('string');
    expect((requestId ?? '').length).toBeGreaterThan(0);
    expect(isValidRequestId(requestId)).toBe(true);
  });

  it('preserves client x-request-id when valid', async () => {
    const testApp = createTestApp();
    const validId = 'test-request-id-123';

    const response = await request(testApp).get('/').set('x-request-id', validId);

    expect(response.status).toBe(200);
    expect(response.headers['x-request-id']).toBe(validId);
  });

  it('replaces oversized client x-request-id (> 64 chars) with server-generated ID', async () => {
    const testApp = createTestApp();
    const oversizedId = 'a'.repeat(MAX_REQUEST_ID_LENGTH + 1);

    const response = await request(testApp).get('/').set('x-request-id', oversizedId);

    expect(response.status).toBe(200);
    const requestId = response.headers['x-request-id'] as string;
    expect(requestId).toBeDefined();
    expect(requestId).not.toBe(oversizedId);
    expect(requestId.length).toBeLessThanOrEqual(MAX_REQUEST_ID_LENGTH);
    expect(isValidRequestId(requestId)).toBe(true);
  });

  it('replaces malformed client x-request-id with server-generated ID', async () => {
    const testApp = createTestApp();
    const malformedIds = [
      'id with spaces',
      '<script>alert(1)</script>',
      'DROP TABLE users;--',
      'invalid@char!',
      'id:colon',
      'id/slash',
      'id=equals',
      '   ',
    ];

    for (const malformedId of malformedIds) {
      const response = await request(testApp).get('/').set('x-request-id', malformedId);

      expect(response.status).toBe(200);
      const requestId = response.headers['x-request-id'] as string;
      expect(requestId).toBeDefined();
      expect(requestId).not.toBe(malformedId.trim());
      expect(isValidRequestId(requestId)).toBe(true);
    }
  });

  it('correlates logger requestId with x-request-id via withContext', async () => {
    const tempApp = express();
    tempApp.use(requestIdMiddleware);
    tempApp.get('/test', (_req, res) => {
      logger.withContext().info('Testing withContext correlation');
      res.sendStatus(200);
    });

    const infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => logger as any);

    const response = await request(tempApp).get('/test');
    const requestId = response.headers['x-request-id'];

    expect(response.status).toBe(200);
    expect(infoSpy).toHaveBeenCalledWith(
      'Testing withContext correlation',
      expect.objectContaining({ requestId }),
    );

    infoSpy.mockRestore();
  });

  // #1522 — the tests above only assert shape/presence/propagation for a
  // single request; none of them prove IDs stay unique when many requests
  // are actually in flight concurrently (the scenario createRequestId is
  // used for in practice, under real traffic).
  it('generates a unique x-request-id for every request in a concurrent burst', async () => {
    const BURST_SIZE = 200;

    // Burst against a minimal app mounting only the middleware under test —
    // going through the full app would trip the global rate limiter
    // (100 req/15 min) long before exercising ID uniqueness.
    const burstApp = express();
    burstApp.use(requestIdMiddleware);
    burstApp.get('/', (_req, res) => res.sendStatus(200));

    const responses = await Promise.all(
      Array.from({ length: BURST_SIZE }, () => request(burstApp).get('/')),
    );

    const requestIds = responses.map((response) => {
      expect(response.status).toBe(200);
      const requestId = response.headers['x-request-id'] as string | undefined;
      expect(typeof requestId).toBe('string');
      expect((requestId ?? '').length).toBeGreaterThan(0);
      return requestId as string;
    });

    expect(new Set(requestIds).size).toBe(BURST_SIZE);
  });

  it('never reuses an ID across overlapping request-scoped async contexts', async () => {
    // Fires requests through a route that awaits inside the handler, so
    // multiple requests' async-context work is genuinely interleaved on
    // the event loop rather than trivially serialized — a stronger check
    // than a burst of already-synchronous responses.
    const tempApp = express();
    tempApp.use(requestIdMiddleware);
    tempApp.get('/interleaved', async (req, res) => {
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 10));
      res.json({ requestId: req.requestId });
    });

    const CONCURRENCY = 100;
    const responses = await Promise.all(
      Array.from({ length: CONCURRENCY }, () => request(tempApp).get('/interleaved')),
    );

    const bodyIds = responses.map((response) => response.body.requestId as string);
    const headerIds = responses.map((response) => response.headers['x-request-id'] as string);

    // Each response's own header must match what the handler itself saw
    // via req.requestId for that same request (no cross-request leakage
    // through the async-local-storage context).
    bodyIds.forEach((id, i) => expect(id).toBe(headerIds[i]));
    expect(new Set(bodyIds).size).toBe(CONCURRENCY);
  });
});

describe('isValidRequestId', () => {
  it('accepts standard RFC 4122 UUIDs', () => {
    expect(isValidRequestId('c9bf9e57-1685-4c89-bafb-ff5af830be8a')).toBe(true);
    expect(isValidRequestId('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
  });

  it('accepts alphanumeric characters, hyphens, dots, and underscores up to 64 chars', () => {
    expect(isValidRequestId('req-123_abc.XYZ')).toBe(true);
    expect(isValidRequestId('a'.repeat(MAX_REQUEST_ID_LENGTH))).toBe(true);
    expect(isValidRequestId('1')).toBe(true);
  });

  it('rejects strings longer than 64 characters', () => {
    expect(isValidRequestId('a'.repeat(MAX_REQUEST_ID_LENGTH + 1))).toBe(false);
    expect(isValidRequestId('a'.repeat(100))).toBe(false);
  });

  it('rejects empty strings or whitespace-only strings', () => {
    expect(isValidRequestId('')).toBe(false);
    expect(isValidRequestId('   ')).toBe(false);
    expect(isValidRequestId('\t\n')).toBe(false);
  });

  it('rejects non-string inputs', () => {
    expect(isValidRequestId(undefined)).toBe(false);
    expect(isValidRequestId(null)).toBe(false);
    expect(isValidRequestId(12345)).toBe(false);
    expect(isValidRequestId({})).toBe(false);
    expect(isValidRequestId([])).toBe(false);
  });

  it('rejects strings containing invalid characters', () => {
    expect(isValidRequestId('id with spaces')).toBe(false);
    expect(isValidRequestId('id\nwith\nnewlines')).toBe(false);
    expect(isValidRequestId('id\rwith\rcarriage')).toBe(false);
    expect(isValidRequestId('<script>alert(1)</script>')).toBe(false);
    expect(isValidRequestId('id;DROP TABLE users;')).toBe(false);
    expect(isValidRequestId('id@domain.com')).toBe(false);
    expect(isValidRequestId('id$variable')).toBe(false);
    expect(isValidRequestId('id/slash')).toBe(false);
    expect(isValidRequestId('id\\backslash')).toBe(false);
  });
});
