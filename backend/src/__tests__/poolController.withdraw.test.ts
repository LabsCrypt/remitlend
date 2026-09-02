import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';

const mockBuildWithdrawTx =
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
    buildWithdrawTx: mockBuildWithdrawTx,
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
    del: jest.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
    delete: jest.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
  },
}));

const { withdrawFromPool } = await import('../controllers/poolController.js');

const flushAsync = async (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const createMockResponse = (): Response =>
  ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  }) as unknown as Response;

describe('withdrawFromPool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('builds an unsigned withdraw transaction with default minAssetsOut (0)', async () => {
    mockBuildWithdrawTx.mockResolvedValue({
      unsignedTxXdr: 'AAAAAgAAAAt3aXRoZHJhdw==',
      networkPassphrase: 'Test SDF Network ; September 2015',
    });

    const req = {
      body: {
        depositorPublicKey: 'GDEPOSITOR123',
        token: 'GTOKEN456',
        amount: 500,
      },
      user: { publicKey: 'GDEPOSITOR123' },
    } as unknown as Request;
    const res = createMockResponse();
    const next = jest.fn<(err?: unknown) => void>();

    withdrawFromPool(req, res, next as unknown as NextFunction);
    await flushAsync();

    expect(mockBuildWithdrawTx).toHaveBeenCalledWith('GDEPOSITOR123', 'GTOKEN456', 500, 0);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      unsignedTxXdr: 'AAAAAgAAAAt3aXRoZHJhdw==',
      networkPassphrase: 'Test SDF Network ; September 2015',
    });
  });

  it('builds an unsigned withdraw transaction with explicit minAssetsOut', async () => {
    mockBuildWithdrawTx.mockResolvedValue({
      unsignedTxXdr: 'AAAAAgAAAAt3aXRoZHJhdw==',
      networkPassphrase: 'Test SDF Network ; September 2015',
    });

    const req = {
      body: {
        depositorPublicKey: 'GDEPOSITOR123',
        token: 'GTOKEN456',
        amount: 500,
        minAssetsOut: 480,
      },
      user: { publicKey: 'GDEPOSITOR123' },
    } as unknown as Request;
    const res = createMockResponse();
    const next = jest.fn<(err?: unknown) => void>();

    withdrawFromPool(req, res, next as unknown as NextFunction);
    await flushAsync();

    expect(mockBuildWithdrawTx).toHaveBeenCalledWith('GDEPOSITOR123', 'GTOKEN456', 500, 480);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      unsignedTxXdr: 'AAAAAgAAAAt3aXRoZHJhdw==',
      networkPassphrase: 'Test SDF Network ; September 2015',
    });
  });

  it('rejects when depositorPublicKey does not match JWT', async () => {
    const req = {
      body: {
        depositorPublicKey: 'GWRONGKEY',
        token: 'GTOKEN456',
        amount: 500,
      },
      user: { publicKey: 'GDEPOSITOR123' },
    } as unknown as Request;
    const res = createMockResponse();
    const next = jest.fn<(err?: unknown) => void>();

    withdrawFromPool(req, res, next as unknown as NextFunction);
    await flushAsync();

    expect(mockBuildWithdrawTx).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it('rejects when required fields are missing', async () => {
    const req = {
      body: { depositorPublicKey: 'GDEPOSITOR123' },
      user: { publicKey: 'GDEPOSITOR123' },
    } as unknown as Request;
    const res = createMockResponse();
    const next = jest.fn<(err?: unknown) => void>();

    withdrawFromPool(req, res, next as unknown as NextFunction);
    await flushAsync();

    expect(mockBuildWithdrawTx).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });
});
