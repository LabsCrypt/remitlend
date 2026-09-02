import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';

const mockBuildEmergencyWithdrawTx =
  jest.fn<
    (
      providerPublicKey: string,
      tokenAddress: string,
      shares: number,
      minAssetsOut?: number,
    ) => Promise<{ unsignedTxXdr: string; networkPassphrase: string }>
  >();

jest.unstable_mockModule('../services/sorobanService.js', () => ({
  sorobanService: {
    buildEmergencyWithdrawTx: mockBuildEmergencyWithdrawTx,
    getSharePrice: jest.fn(),
  },
}));

jest.unstable_mockModule('../db/connection.js', () => ({
  query: jest.fn(),
  getClient: jest.fn(),
}));

jest.unstable_mockModule('../services/cacheService.js', () => ({
  cacheService: {
    get: jest.fn<(...args: unknown[]) => Promise<null>>().mockResolvedValue(null),
    set: jest.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
  },
}));

const { emergencyWithdrawFromPool } = await import('../controllers/poolController.js');

const flushAsync = async (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const createMockResponse = (): Response =>
  ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  }) as unknown as Response;

describe('emergencyWithdrawFromPool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('builds an unsigned emergency withdraw transaction with default minAssetsOut (0)', async () => {
    mockBuildEmergencyWithdrawTx.mockResolvedValue({
      unsignedTxXdr: 'AAAAAgAAAAtlbWVyZ2VuY3lfd2l0aGRyYXc=',
      networkPassphrase: 'Test SDF Network ; September 2015',
    });

    const req = {
      body: {
        depositorPublicKey: 'GDEPOSITOR123',
        token: 'GTOKEN456',
        shares: 500,
      },
      user: { publicKey: 'GDEPOSITOR123' },
    } as unknown as Request;
    const res = createMockResponse();
    const next = jest.fn<(err?: unknown) => void>();

    emergencyWithdrawFromPool(req, res, next as unknown as NextFunction);
    await flushAsync();

    expect(mockBuildEmergencyWithdrawTx).toHaveBeenCalledWith('GDEPOSITOR123', 'GTOKEN456', 500, 0);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      unsignedTxXdr: 'AAAAAgAAAAtlbWVyZ2VuY3lfd2l0aGRyYXc=',
      networkPassphrase: 'Test SDF Network ; September 2015',
    });
  });

  it('builds an unsigned emergency withdraw transaction with explicit minAssetsOut', async () => {
    mockBuildEmergencyWithdrawTx.mockResolvedValue({
      unsignedTxXdr: 'AAAAAgAAAAtlbWVyZ2VuY3lfd2l0aGRyYXc=',
      networkPassphrase: 'Test SDF Network ; September 2015',
    });

    const req = {
      body: {
        depositorPublicKey: 'GDEPOSITOR123',
        token: 'GTOKEN456',
        shares: 500,
        minAssetsOut: 450,
      },
      user: { publicKey: 'GDEPOSITOR123' },
    } as unknown as Request;
    const res = createMockResponse();
    const next = jest.fn<(err?: unknown) => void>();

    emergencyWithdrawFromPool(req, res, next as unknown as NextFunction);
    await flushAsync();

    expect(mockBuildEmergencyWithdrawTx).toHaveBeenCalledWith(
      'GDEPOSITOR123',
      'GTOKEN456',
      500,
      450,
    );
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      unsignedTxXdr: 'AAAAAgAAAAtlbWVyZ2VuY3lfd2l0aGRyYXc=',
      networkPassphrase: 'Test SDF Network ; September 2015',
    });
  });

  it('rejects when depositorPublicKey does not match JWT', async () => {
    const req = {
      body: {
        depositorPublicKey: 'GWRONGKEY',
        token: 'GTOKEN456',
        shares: 500,
      },
      user: { publicKey: 'GDEPOSITOR123' },
    } as unknown as Request;
    const res = createMockResponse();
    const next = jest.fn<(err?: unknown) => void>();

    emergencyWithdrawFromPool(req, res, next as unknown as NextFunction);
    await flushAsync();

    expect(mockBuildEmergencyWithdrawTx).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it('rejects when required fields are missing', async () => {
    const req = {
      body: { depositorPublicKey: 'GDEPOSITOR123' },
      user: { publicKey: 'GDEPOSITOR123' },
    } as unknown as Request;
    const res = createMockResponse();
    const next = jest.fn<(err?: unknown) => void>();

    emergencyWithdrawFromPool(req, res, next as unknown as NextFunction);
    await flushAsync();

    expect(mockBuildEmergencyWithdrawTx).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });
});
