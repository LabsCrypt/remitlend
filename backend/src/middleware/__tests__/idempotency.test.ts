import { Request, Response, NextFunction } from 'express';
import { idempotencyMiddleware, computeFingerprint, namespacedKey } from '../idempotency.js';
import { cacheService } from '../../services/cacheService.js';
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

const asMock = (fn: unknown) => fn as jest.Mock;

describe('Idempotency Middleware Comprehensive Tests (#2097)', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: NextFunction;
  let finishListeners: Array<() => Promise<void> | void>;

  const createMockResponse = (): Partial<Response> => {
    finishListeners = [];
    const mockRes: Partial<Response> = {
      statusCode: 200,
      status: jest.fn().mockImplementation((code: number) => {
        mockRes.statusCode = code;
        return mockRes;
      }) as unknown as Response['status'],
      set: jest.fn().mockImplementation(() => mockRes) as unknown as Response['set'],
      json: jest.fn().mockImplementation(() => mockRes) as unknown as Response['json'],
      send: jest.fn().mockImplementation(() => mockRes) as unknown as Response['send'],
      on: jest.fn().mockImplementation((event: string, listener: () => Promise<void> | void) => {
        if (event === 'finish') {
          finishListeners.push(listener);
        }
        return mockRes;
      }) as unknown as Response['on'],
    };
    return mockRes;
  };

  const triggerFinish = async () => {
    for (const listener of finishListeners) {
      await listener();
    }
  };

  beforeEach(() => {
    req = {
      header: jest.fn() as unknown as Request['header'],
      method: 'POST',
      originalUrl: '/api/loans/request',
      baseUrl: '',
      path: '/api/loans/request',
      body: { amount: 500, currency: 'USDC' },
    };
    res = createMockResponse();
    next = jest.fn();

    jest.spyOn(cacheService, 'get').mockReset();
    jest.spyOn(cacheService, 'set').mockReset();
    jest.spyOn(cacheService, 'setNotExists').mockReset();
    jest.spyOn(cacheService, 'delete').mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Missing or Empty Idempotency Key', () => {
    it('passes through to next() immediately when Idempotency-Key header is omitted', async () => {
      asMock(req.header).mockReturnValue(undefined);

      await idempotencyMiddleware(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(cacheService.get).not.toHaveBeenCalled();
      expect(cacheService.setNotExists).not.toHaveBeenCalled();
    });

    it('passes through to next() when Idempotency-Key header is empty string', async () => {
      asMock(req.header).mockReturnValue('');

      await idempotencyMiddleware(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(cacheService.get).not.toHaveBeenCalled();
      expect(cacheService.setNotExists).not.toHaveBeenCalled();
    });
  });

  describe('Concurrent Identical Requests', () => {
    it('returns 409 Conflict when an in-flight lock exists for the same key', async () => {
      const key = 'concurrent-key-1';
      asMock(req.header).mockReturnValue(key);
      (cacheService.get as jest.Mock<() => Promise<unknown>>).mockResolvedValue(null);
      // Lock acquisition fails because another request is currently in flight
      (cacheService.setNotExists as jest.Mock<() => Promise<unknown>>).mockResolvedValue(false);

      await idempotencyMiddleware(req as Request, res as Response, next);

      expect(cacheService.setNotExists).toHaveBeenCalledWith(
        `idemp:anon:${key}:lock`,
        expect.objectContaining({ pid: process.pid }),
        30,
      );
      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({
        error: 'A request with this Idempotency-Key is already in progress.',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('handles simulated simultaneous race between two identical requests deterministically', async () => {
      const key = 'race-key-simultaneous';
      const inFlightLocks = new Set<string>();

      // Stateful lock simulation for atomic concurrency
      (cacheService.get as jest.Mock<() => Promise<unknown>>).mockResolvedValue(null);
      (cacheService.setNotExists as jest.Mock).mockImplementation(async (lockKey: string) => {
        if (inFlightLocks.has(lockKey)) {
          return false;
        }
        inFlightLocks.add(lockKey);
        return true;
      });

      // Request 1
      const req1 = { ...req, header: jest.fn().mockReturnValue(key) } as unknown as Request;
      const res1 = createMockResponse();
      const next1 = jest.fn();

      // Request 2 (concurrent identical request)
      const req2 = { ...req, header: jest.fn().mockReturnValue(key) } as unknown as Request;
      const res2 = createMockResponse();
      const next2 = jest.fn();

      // Execute concurrently
      await Promise.all([
        idempotencyMiddleware(req1, res1 as Response, next1),
        idempotencyMiddleware(req2, res2 as Response, next2),
      ]);

      // Exactly one succeeds and calls next(); the other gets 409 Conflict
      const nextCalls = next1.mock.calls.length + next2.mock.calls.length;
      expect(nextCalls).toBe(1);

      const conflictCalls =
        (asMock(res1.status).mock.calls.some(([code]) => code === 409) ? 1 : 0) +
        (asMock(res2.status).mock.calls.some(([code]) => code === 409) ? 1 : 0);
      expect(conflictCalls).toBe(1);
    });

    it('releases lock and caches response on completion, allowing subsequent replay', async () => {
      const key = 'lifecycle-key-seq';
      asMock(req.header).mockReturnValue(key);
      (cacheService.get as jest.Mock<() => Promise<unknown>>).mockResolvedValue(null);
      (cacheService.setNotExists as jest.Mock<() => Promise<unknown>>).mockResolvedValue(true);

      // Step 1: Initial request starts
      await idempotencyMiddleware(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.set).toHaveBeenCalledWith('X-Idempotent-Replayed', 'false');

      // Step 2: Route completes and writes response body
      res.statusCode = 201;
      (res.json as unknown as (body: unknown) => void)({ loanId: 'ln_123', status: 'approved' });

      // Step 3: Response finishes
      await triggerFinish();

      // Lock is released
      expect(cacheService.delete).toHaveBeenCalledWith(`idemp:anon:${key}:lock`);
      // Response is cached with 24-hour TTL (86400s)
      expect(cacheService.set).toHaveBeenCalledWith(
        `idemp:anon:${key}`,
        expect.objectContaining({
          status: 201,
          body: { loanId: 'ln_123', status: 'approved' },
          fingerprint: computeFingerprint(req as Request).fingerprint,
        }),
        86400,
      );
    });
  });

  describe('Failed Replay & Conflict Scenarios', () => {
    it('rejects replay with 409 Conflict when HTTP method differs', async () => {
      const key = 'mismatched-method-key';
      const cached = {
        status: 200,
        body: { result: 'ok' },
        fingerprint: 'GET /api/loans/request#some-hash',
      };
      asMock(req.header).mockReturnValue(key);
      (cacheService.get as jest.Mock<() => Promise<unknown>>).mockResolvedValue(cached);

      await idempotencyMiddleware(req as Request, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({
        error:
          'This Idempotency-Key was already used for a different request (method, path, or body).',
      });
      expect(next).not.toHaveBeenCalled();
      expect(cacheService.setNotExists).not.toHaveBeenCalled();
    });

    it('rejects replay with 409 Conflict when URL path differs', async () => {
      const key = 'mismatched-path-key';
      const originalFingerprint = computeFingerprint({
        method: 'POST',
        originalUrl: '/api/loans/repay',
        path: '/api/loans/repay',
        body: req.body,
      } as Request).fingerprint;

      const cached = {
        status: 200,
        body: { result: 'ok' },
        fingerprint: originalFingerprint,
      };
      asMock(req.header).mockReturnValue(key);
      (cacheService.get as jest.Mock<() => Promise<unknown>>).mockResolvedValue(cached);

      await idempotencyMiddleware(req as Request, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({
        error:
          'This Idempotency-Key was already used for a different request (method, path, or body).',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('rejects replay with 409 Conflict when request body differs', async () => {
      const key = 'mismatched-body-key';
      const differentFingerprint = computeFingerprint({
        method: 'POST',
        originalUrl: req.originalUrl,
        path: req.path,
        body: { amount: 9999, currency: 'USDC' },
      } as Request).fingerprint;

      const cached = {
        status: 201,
        body: { loanId: 'loan-1' },
        fingerprint: differentFingerprint,
      };
      asMock(req.header).mockReturnValue(key);
      (cacheService.get as jest.Mock<() => Promise<unknown>>).mockResolvedValue(cached);

      await idempotencyMiddleware(req as Request, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({
        error:
          'This Idempotency-Key was already used for a different request (method, path, or body).',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('does NOT cache 5xx server errors on finish (retries must execute fresh)', async () => {
      const key = 'server-error-key';
      asMock(req.header).mockReturnValue(key);
      (cacheService.get as jest.Mock<() => Promise<unknown>>).mockResolvedValue(null);
      (cacheService.setNotExists as jest.Mock<() => Promise<unknown>>).mockResolvedValue(true);

      await idempotencyMiddleware(req as Request, res as Response, next);

      // Route encountered unhandled internal error
      res.statusCode = 500;
      (res.json as unknown as (body: unknown) => void)({ error: 'Internal database failure' });

      await triggerFinish();

      // Lock is still cleaned up to unblock retries
      expect(cacheService.delete).toHaveBeenCalledWith(`idemp:anon:${key}:lock`);
      // 5xx status codes MUST NOT be cached
      expect(cacheService.set).not.toHaveBeenCalled();
    });

    it('does NOT cache 503 service unavailable errors on finish', async () => {
      const key = 'service-unavailable-key';
      asMock(req.header).mockReturnValue(key);
      (cacheService.get as jest.Mock<() => Promise<unknown>>).mockResolvedValue(null);
      (cacheService.setNotExists as jest.Mock<() => Promise<unknown>>).mockResolvedValue(true);

      await idempotencyMiddleware(req as Request, res as Response, next);

      res.statusCode = 503;
      (res.json as unknown as (body: unknown) => void)({ error: 'Service Unavailable' });

      await triggerFinish();

      expect(cacheService.delete).toHaveBeenCalledWith(`idemp:anon:${key}:lock`);
      expect(cacheService.set).not.toHaveBeenCalled();
    });

    it('fails open and calls next() if cacheService.get throws an unexpected error', async () => {
      const key = 'redis-failure-key';
      asMock(req.header).mockReturnValue(key);
      (cacheService.get as jest.Mock<() => Promise<unknown>>).mockRejectedValue(
        new Error('Redis connection timed out'),
      );

      await idempotencyMiddleware(req as Request, res as Response, next);

      // Fails open gracefully to prevent blocking valid user requests
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('handles lock deletion failure on finish without unhandled rejection', async () => {
      const key = 'lock-delete-failure-key';
      asMock(req.header).mockReturnValue(key);
      (cacheService.get as jest.Mock<() => Promise<unknown>>).mockResolvedValue(null);
      (cacheService.setNotExists as jest.Mock<() => Promise<unknown>>).mockResolvedValue(true);
      (cacheService.delete as jest.Mock<() => Promise<unknown>>).mockRejectedValue(
        new Error('Redis socket closed'),
      );

      await idempotencyMiddleware(req as Request, res as Response, next);

      res.statusCode = 200;
      (res.json as unknown as (body: unknown) => void)({ ok: true });

      // Should not throw or crash
      await expect(triggerFinish()).resolves.not.toThrow();
    });
  });

  describe('Expired Keys and Lock Expiry', () => {
    it('treats an expired key (cache miss after TTL) as a fresh request', async () => {
      const key = 'expired-key';
      asMock(req.header).mockReturnValue(key);
      // Cache entry expired or evicted from Redis
      (cacheService.get as jest.Mock<() => Promise<unknown>>).mockResolvedValue(null);
      (cacheService.setNotExists as jest.Mock<() => Promise<unknown>>).mockResolvedValue(true);

      await idempotencyMiddleware(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.set).toHaveBeenCalledWith('X-Idempotent-Replayed', 'false');
      expect(cacheService.setNotExists).toHaveBeenCalledWith(
        `idemp:anon:${key}:lock`,
        expect.any(Object),
        30,
      );
    });

    it('allows a subsequent request to acquire the lock after previous lock TTL expired', async () => {
      const key = 'stale-lock-recovery-key';
      asMock(req.header).mockReturnValue(key);
      (cacheService.get as jest.Mock<() => Promise<unknown>>).mockResolvedValue(null);
      // Lock successfully acquired (previous lock expired via Redis TTL)
      (cacheService.setNotExists as jest.Mock<() => Promise<unknown>>).mockResolvedValue(true);

      await idempotencyMiddleware(req as Request, res as Response, next);

      expect(cacheService.setNotExists).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe('Public Response Headers and Body Interception', () => {
    it('replays cached response with X-Idempotency-Cache: HIT and X-Idempotent-Replayed: true', async () => {
      const key = 'valid-replay-headers';
      const storedBody = { balance: 1250, currency: 'XLM' };
      const cached = {
        status: 200,
        body: storedBody,
        fingerprint: computeFingerprint(req as Request).fingerprint,
      };
      asMock(req.header).mockReturnValue(key);
      (cacheService.get as jest.Mock<() => Promise<unknown>>).mockResolvedValue(cached);

      await idempotencyMiddleware(req as Request, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.set).toHaveBeenCalledWith('X-Idempotency-Cache', 'HIT');
      expect(res.set).toHaveBeenCalledWith('X-Idempotent-Replayed', 'true');
      expect(res.json).toHaveBeenCalledWith(storedBody);
      expect(next).not.toHaveBeenCalled();
    });

    it('caches 4xx client errors (e.g. 400 Bad Request, 422 Unprocessable) deterministically', async () => {
      const key = 'cache-400-client-error';
      asMock(req.header).mockReturnValue(key);
      (cacheService.get as jest.Mock<() => Promise<unknown>>).mockResolvedValue(null);
      (cacheService.setNotExists as jest.Mock<() => Promise<unknown>>).mockResolvedValue(true);

      await idempotencyMiddleware(req as Request, res as Response, next);

      res.statusCode = 422;
      (res.json as unknown as (body: unknown) => void)({
        error: 'Validation failed: amount must be > 0',
      });

      await triggerFinish();

      expect(cacheService.delete).toHaveBeenCalledWith(`idemp:anon:${key}:lock`);
      expect(cacheService.set).toHaveBeenCalledWith(
        `idemp:anon:${key}`,
        expect.objectContaining({
          status: 422,
          body: { error: 'Validation failed: amount must be > 0' },
        }),
        86400,
      );
    });

    it('intercepts res.send with JSON string correctly', async () => {
      const key = 'send-string-interception';
      asMock(req.header).mockReturnValue(key);
      (cacheService.get as jest.Mock<() => Promise<unknown>>).mockResolvedValue(null);
      (cacheService.setNotExists as jest.Mock<() => Promise<unknown>>).mockResolvedValue(true);

      await idempotencyMiddleware(req as Request, res as Response, next);

      res.statusCode = 200;
      const jsonPayload = JSON.stringify({ message: 'plain string send' });
      (res.send as unknown as (body: unknown) => void)(jsonPayload);

      await triggerFinish();

      expect(cacheService.set).toHaveBeenCalledWith(
        `idemp:anon:${key}`,
        expect.objectContaining({
          status: 200,
          body: { message: 'plain string send' },
        }),
        86400,
      );
    });
  });

  describe('Authorization and Wallet Namespacing', () => {
    it('isolates idempotency keys between authenticated wallets and anonymous callers', async () => {
      const key = 'user-isolated-key';
      const aliceReq = {
        ...req,
        header: jest.fn().mockReturnValue(key),
        user: { publicKey: 'GBD_ALICE_WALLET_99' },
      } as unknown as Request;

      (cacheService.get as jest.Mock<() => Promise<unknown>>).mockResolvedValue(null);
      (cacheService.setNotExists as jest.Mock<() => Promise<unknown>>).mockResolvedValue(true);

      await idempotencyMiddleware(aliceReq, res as Response, next);

      expect(cacheService.get).toHaveBeenCalledWith(`idemp:GBD_ALICE_WALLET_99:${key}`);
      expect(cacheService.setNotExists).toHaveBeenCalledWith(
        `idemp:GBD_ALICE_WALLET_99:${key}:lock`,
        expect.any(Object),
        30,
      );
    });

    it('namespacedKey helper generates consistent namespace prefix', () => {
      expect(namespacedKey('GBD_WALLET_1', 'abc-123')).toBe('GBD_WALLET_1:abc-123');
      expect(namespacedKey('anon', 'tx-456')).toBe('anon:tx-456');
    });
  });
});
