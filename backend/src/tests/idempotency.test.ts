import { Request, Response, NextFunction } from 'express';
import { idempotencyMiddleware } from '../middleware/idempotency.js';
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
      originalUrl: '/api/test',
    };
    res = {
      status: jest.fn().mockReturnThis() as unknown as Response['status'],
      set: jest.fn().mockReturnThis() as unknown as Response['set'],
      json: jest.fn().mockReturnThis() as unknown as Response['json'],
      send: jest.fn().mockReturnThis() as unknown as Response['send'],
      on: jest.fn() as unknown as Response['on'],
      statusCode: 200,
    };
    next = jest.fn();

    // Mock cacheService explicitly for each test
    jest.spyOn(cacheService, 'get').mockReset();
    jest.spyOn(cacheService, 'set').mockReset();
    jest.spyOn(cacheService, 'setNotExists').mockResolvedValue(true);
    jest.spyOn(cacheService, 'delete').mockResolvedValue();
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

  it('should return cached response if key exists', async () => {
    const key = 'test-key';
    const cachedResponse = { status: 201, body: { success: true } };
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
    const cachedResponse = { status: 200, body: { id: 99 } };
    asMock(req.header).mockReturnValue(key);
    (cacheService.get as jest.Mock<() => Promise<unknown>>).mockResolvedValue(cachedResponse);

    await idempotencyMiddleware(req as Request, res as Response, next);

    expect(res.set).toHaveBeenCalledWith('X-Idempotent-Replayed', 'true');
    expect(next).not.toHaveBeenCalled();
  });

  it('sets X-Idempotent-Replayed: false on a fresh (cache miss) execution', async () => {
    const key = 'fresh-key';
    asMock(req.header).mockReturnValue(key);
    (cacheService.get as jest.Mock<() => Promise<unknown>>).mockResolvedValue(null);

    await idempotencyMiddleware(req as Request, res as Response, next);

    expect(res.set).toHaveBeenCalledWith('X-Idempotent-Replayed', 'false');
    expect(next).toHaveBeenCalled();
  });

  it('should proceed and intercept response on cache miss', async () => {
    const key = 'new-key';
    asMock(req.header).mockReturnValue(key);
    (cacheService.get as jest.Mock<() => Promise<unknown>>).mockResolvedValue(null);

    await idempotencyMiddleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
    expect(res.on).toHaveBeenCalledWith('finish', expect.any(Function));
  });
});
