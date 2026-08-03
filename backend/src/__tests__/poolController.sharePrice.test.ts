import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';

const mockGetSharePrice = jest.fn<(tokenAddress?: string) => Promise<number>>();
const mockCacheGet = jest.fn<() => Promise<unknown>>();
const mockCacheSet = jest.fn<() => Promise<void>>();

jest.unstable_mockModule('../services/sorobanService.js', () => ({
  sorobanService: {
    getSharePrice: mockGetSharePrice,
  },
}));

jest.unstable_mockModule('../services/cacheService.js', () => ({
  cacheService: {
    get: mockCacheGet,
    set: mockCacheSet,
  },
}));

jest.unstable_mockModule('../db/connection.js', () => ({
  query: jest.fn(),
  getClient: jest.fn(),
}));

const { getPoolSharePrice } = await import('../controllers/poolController.js');

const flushAsync = async (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const createMockResponse = (): Response =>
  ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  }) as unknown as Response;

describe('getPoolSharePrice', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns share price from on-chain contract', async () => {
    mockCacheGet.mockResolvedValue(null);
    mockGetSharePrice.mockResolvedValue(1_050_000);

    const req = {
      params: { token: 'GTOKEN123' },
    } as unknown as Request;
    const res = createMockResponse();
    const next = jest.fn<(err?: unknown) => void>();

    getPoolSharePrice(req, res, next as unknown as NextFunction);
    await flushAsync();

    expect(mockGetSharePrice).toHaveBeenCalledWith('GTOKEN123');
    expect(mockCacheSet).toHaveBeenCalledWith(
      expect.stringContaining('GTOKEN123'),
      { sharePrice: 1_050_000, sharePriceRatio: 1.05 },
      30,
    );
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { sharePrice: 1_050_000, sharePriceRatio: 1.05 },
      cached: false,
    });
  });

  it('returns cached share price without calling contract', async () => {
    mockCacheGet.mockResolvedValue({
      sharePrice: 1_050_000,
      sharePriceRatio: 1.05,
    });

    const req = {
      params: { token: 'GTOKEN123' },
    } as unknown as Request;
    const res = createMockResponse();
    const next = jest.fn<(err?: unknown) => void>();

    getPoolSharePrice(req, res, next as unknown as NextFunction);
    await flushAsync();

    expect(mockGetSharePrice).not.toHaveBeenCalled();
    expect(mockCacheSet).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { sharePrice: 1_050_000, sharePriceRatio: 1.05 },
      cached: true,
    });
  });

  it('returns share price ratio with correct human-readable value', async () => {
    mockCacheGet.mockResolvedValue(null);
    mockGetSharePrice.mockResolvedValue(2_000_000);

    const req = {
      params: { token: 'GTOKEN123' },
    } as unknown as Request;
    const res = createMockResponse();
    const next = jest.fn<(err?: unknown) => void>();

    getPoolSharePrice(req, res, next as unknown as NextFunction);
    await flushAsync();

    const jsonCall = (res.json as jest.Mock).mock.calls[0]?.[0] as Record<string, unknown>;
    expect((jsonCall.data as Record<string, unknown>).sharePriceRatio).toBe(2.0);
  });

  it('de-scales a fresh pool price to one without changing the raw value', async () => {
    mockCacheGet.mockResolvedValue(null);
    mockGetSharePrice.mockResolvedValue(1_000_000);

    const req = {
      params: { token: 'GFRESHPOOL' },
    } as unknown as Request;
    const res = createMockResponse();
    const next = jest.fn<(err?: unknown) => void>();

    getPoolSharePrice(req, res, next as unknown as NextFunction);
    await flushAsync();

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        sharePrice: 1_000_000,
        sharePriceRatio: 1,
      },
      cached: false,
    });
  });
});
