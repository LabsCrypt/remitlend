import request from 'supertest';
import app from '../app.js';
import logger from '../utils/logger.js';
import { jest } from '@jest/globals';

import express from 'express';
import { requestIdMiddleware } from '../middleware/requestId.js';

describe('Request ID middleware', () => {
  it('adds x-request-id when missing', async () => {
    const response = await request(app).get('/');
    const requestId = response.headers['x-request-id'] as string | undefined;

    expect(response.status).toBe(200);
    expect(requestId).toBeDefined();
    expect(typeof requestId).toBe('string');
    expect((requestId ?? '').length).toBeGreaterThan(0);
  });

  it('preserves client x-request-id', async () => {
    const requestId = 'test-request-id-123';

    const response = await request(app).get('/').set('x-request-id', requestId);

    expect(response.status).toBe(200);
    expect(response.headers['x-request-id']).toBe(requestId);
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
