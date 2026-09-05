import { Request, Response, NextFunction } from 'express';
import { idempotencyMiddleware, computeFingerprint } from '../middleware/idempotency.js';
import { cacheService } from '../services/cacheService.js';
import { jest } from '@jest/globals';

// Helper to cast to jest.Mock
const asMock = (fn: unknown) => fn as jest.Mock;

describe('Idempotency Middleware', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    req = {
      header: jest.fn() as unknown as Request['header'],
      method: 'POST',
      originalUrl: '/api/loans/request',
      path: '/api/loans/request',
      baseUrl: '',
      body: { amount: 100, borrowerPublicKey: 'GBD' },
    };
    res = {
      status: jest.fn().mockReturnThis() as unknown as Response['status'],
      set: jest.fn().mockReturnThis() as unknown as Response['set'],
      json: jest.fn().mockReturnThis() as unknown as Response['json'],
      send: jest.fn().mockReturnThis() as unknown as Response['send'],
      on: jest.fn() as unknown as Response['on'],
      statusCode: 201,
    };
    next = jest.fn();

    // Mock cacheService explicitly for each test
    jest.spyOn(cacheService, 'get').mockReset();
    jest.spyOn(cacheService, 'set').mockReset();
    jest.spyOn(cacheService, 'setNotExists').mockReset();
    jest.spyOn(cacheService, 'delete').mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should call next() if no Idempotency-Key is present', async () => {
    asMock(req.header).mockReturnValue(undefined);

    await idempotencyMiddleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
    expect(cacheService.get).not.toHaveBeenCalled();
  });

  it('should return cached response if key exists for the same request', async () => {
    const key = 'test-key';
    const cachedResponse = {
      status: 201,
      body: { success: true },
      fingerprint: computeFingerprint(req as Request).fingerprint,
    };
    asMock(req.header).mockReturnValue(key);
    (cacheService.get as jest.Mock<() => Promise<unknown>>).mockResolvedValue(cachedResponse);

    await idempotencyMiddleware(req as Request, res as Response, next);

    expect(cacheService.get).toHaveBeenCalledWith(`idemp:${key}`);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.set).toHaveBeenCalledWith('X-Idempotency-Cache', 'HIT');
    expect(res.json).toHaveBeenCalledWith(cachedResponse.body);
    expect(next).not.toHaveBeenCalled();
  });

  it('sets X-Idempotent-Replayed: true on a cache hit (replayed response)', async () => {
    const key = 'replay-key';
    const cachedResponse = {
      status: 200,
      body: { id: 99 },
      fingerprint: computeFingerprint(req as Request).fingerprint,
    };
    asMock(req.header).mockReturnValue(key);
    (cacheService.get as jest.Mock<() => Promise<unknown>>).mockResolvedValue(cachedResponse);

    await idempotencyMiddleware(req as Request, res as Response, next);

    expect(res.set).toHaveBeenCalledWith('X-Idempotent-Replayed', 'true');
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a reused Idempotency-Key whose fingerprint differs (cross-endpoint replay)', async () => {
    const key = 'reuse-key';
    // A previously cached response was stored for a *different* request (e.g.
    // a different path or body), so replaying it would return the wrong result.
    const cachedResponse = {
      status: 201,
      body: { success: true, source: 'original' },
      fingerprint: 'GET /api/pool/build-deposit#some-other-hash',
    };
    asMock(req.header).mockReturnValue(key);
    (cacheService.get as jest.Mock<() => Promise<unknown>>).mockResolvedValue(cachedResponse);

    await idempotencyMiddleware(req as Request, res as Response, next);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(cacheService.setNotExists).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a reused Idempotency-Key with the same path but a different body', async () => {
    const key = 'reuse-key';
    const cachedResponse = {
      status: 201,
      body: { success: true },
      fingerprint: computeFingerprint({
        method: 'POST',
        originalUrl: '/api/loans/request',
        baseUrl: '',
        path: '/api/loans/request',
        body: { amount: 999 },
      } as Request).fingerprint,
    };
    asMock(req.header).mockReturnValue(key);
    (cacheService.get as jest.Mock<() => Promise<unknown>>).mockResolvedValue(cachedResponse);

    await idempotencyMiddleware(req as Request, res as Response, next);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(next).not.toHaveBeenCalled();
  });

  it('sets X-Idempotent-Replayed: false on a fresh (cache miss) execution', async () => {
    const key = 'fresh-key';
    asMock(req.header).mockReturnValue(key);
    (cacheService.get as jest.Mock<() => Promise<unknown>>).mockResolvedValue(null);
    (cacheService.setNotExists as jest.Mock<() => Promise<unknown>>).mockResolvedValue(true);

    await idempotencyMiddleware(req as Request, res as Response, next);

    expect(res.set).toHaveBeenCalledWith('X-Idempotent-Replayed', 'false');
    expect(next).toHaveBeenCalled();
  });

  it('should proceed and intercept response on cache miss', async () => {
    const key = 'new-key';
    asMock(req.header).mockReturnValue(key);
    (cacheService.get as jest.Mock<() => Promise<unknown>>).mockResolvedValue(null);
    (cacheService.setNotExists as jest.Mock<() => Promise<unknown>>).mockResolvedValue(true);

    await idempotencyMiddleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
    expect(res.on).toHaveBeenCalledWith('finish', expect.any(Function));
  });

  it('stores the response together with its fingerprint on finish', async () => {
    const key = 'persist-key';
    asMock(req.header).mockReturnValue(key);
    (cacheService.get as jest.Mock<() => Promise<unknown>>).mockResolvedValue(null);
    (cacheService.setNotExists as jest.Mock<() => Promise<unknown>>).mockResolvedValue(true);

    let finishHandler: () => void = () => {};
    (res.on as jest.Mock).mockImplementation((_: string, cb: () => void) => {
      finishHandler = cb;
      return res;
    });

    await idempotencyMiddleware(req as Request, res as Response, next);

    // Simulate the route writing the response after next() — invokes the
    // middleware's res.json override, which captures responseBody.
    (res.json as unknown as (b: unknown) => void)({ success: true });
    await finishHandler();

    expect(cacheService.delete).toHaveBeenCalledWith(`idemp:${key}:lock`);
    const setCall = (cacheService.set as jest.Mock).mock.calls[0];
    expect(setCall[0]).toBe(`idemp:${key}`);
    const stored = setCall[1] as { fingerprint: string; body: unknown };
    expect(stored.body).toEqual({ success: true });
    expect(stored.fingerprint).toBe(computeFingerprint(req as Request).fingerprint);
  });

  it('returns 409 when another request with the same key is already in progress', async () => {
    const key = 'locked-key';
    asMock(req.header).mockReturnValue(key);
    (cacheService.get as jest.Mock<() => Promise<unknown>>).mockResolvedValue(null);
    (cacheService.setNotExists as jest.Mock<() => Promise<unknown>>).mockResolvedValue(false);

    await idempotencyMiddleware(req as Request, res as Response, next);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(next).not.toHaveBeenCalled();
  });
});
