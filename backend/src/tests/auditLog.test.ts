import { jest } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

jest.unstable_mockModule('../db/connection.js', () => ({
  withAdvisoryLock: async (_key: string, fn: () => Promise<unknown>) => fn(),
  query: jest.fn(),
  default: { query: jest.fn() },
}));

const mockLoggerError = jest.fn();
const mockLoggerWarn = jest.fn();
jest.unstable_mockModule('../utils/logger.js', () => ({
  default: {
    error: mockLoggerError,
    warn: mockLoggerWarn,
    info: jest.fn(),
    debug: jest.fn(),
    withContext: () => ({
      error: mockLoggerError,
      warn: mockLoggerWarn,
      info: jest.fn(),
      debug: jest.fn(),
    }),
  },
}));

const { createAuditLogMiddleware } = await import('../middleware/auditLog.js');

const mockPersist = jest.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
const auditLog = createAuditLogMiddleware({
  persistAuditLog: mockPersist,
  logger: { error: mockLoggerError, warn: mockLoggerWarn },
});

describe('Audit Log Middleware', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPersist.mockResolvedValue(undefined);

    req = {
      method: 'POST',
      path: '/admin/check-defaults',
      headers: { 'x-api-key': 'test-api-key' },
      body: { loanIds: [1, 2, 3] },
      ip: '127.0.0.1',
      socket: {} as import('net').Socket,
      params: {},
    };
    res = {
      statusCode: 200,
      on: jest.fn((event: string, callback: () => void) => {
        if (event === 'finish') {
          setTimeout(callback, 0);
        }
        return res as Response;
      }),
    };
    next = jest.fn();
  });

  it('persists the admin action through the injected dependency', async () => {
    auditLog(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(mockPersist).toHaveBeenCalledWith(
      'INTERNAL_API_KEY',
      'POST /admin/check-defaults',
      'LoanIDs:[1,2,3]',
      { loanIds: [1, 2, 3] },
      '127.0.0.1',
      200,
    );
  });

  it('redacts sensitive fields at any depth before persistence', async () => {
    req.body = {
      secret: 'sensitive-data',
      loanId: 123,
      tx: {
        signedTxXdr: 'nested-sensitive-data',
        details: { token: 'deep-secret', publicInfo: 'safe' },
      },
    };

    auditLog(req as Request, res as Response, next);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(mockPersist).toHaveBeenCalledWith(
      'INTERNAL_API_KEY',
      'POST /admin/check-defaults',
      'LoanID:123',
      {
        secret: '[REDACTED]',
        loanId: 123,
        tx: {
          signedTxXdr: '[REDACTED]',
          details: { token: '[REDACTED]', publicInfo: 'safe' },
        },
      },
      '127.0.0.1',
      200,
    );
  });

  it('uses the JWT actor and records denied responses', async () => {
    (req as unknown as { user: { publicKey: string; role: string } }).user = {
      publicKey: 'G-STUDENT-WALLET-ADDR',
      role: 'admin',
    };
    res.statusCode = 403;

    auditLog(req as Request, res as Response, next);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(mockPersist).toHaveBeenCalledWith(
      'G-STUDENT-WALLET-ADDR',
      'POST /admin/check-defaults',
      'LoanIDs:[1,2,3]',
      { loanIds: [1, 2, 3] },
      '127.0.0.1',
      403,
    );
  });

  it('logs persistence failures without blocking requests', async () => {
    const failure = new Error('insert failed');
    mockPersist.mockRejectedValueOnce(failure);

    auditLog(req as Request, res as Response, next);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(next).toHaveBeenCalled();
    expect(mockLoggerError).toHaveBeenCalledWith(
      'Audit logging failure',
      expect.objectContaining({ err: failure }),
    );
  });
});
