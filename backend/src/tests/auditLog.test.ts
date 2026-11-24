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

  describe('anonymous requests, impersonation, and failed writes', () => {
    it('attributes unauthenticated requests to actor "unknown"', async () => {
      req.headers = {};
      delete (req as unknown as { user?: unknown }).user;
      req.method = 'GET';
      req.path = '/api/loans/101';
      req.params = { id: '101' };
      req.body = undefined;

      auditLog(req as Request, res as Response, next);
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(next).toHaveBeenCalled();
      expect(mockPersist).toHaveBeenCalledWith(
        'unknown',
        'GET /api/loans/101',
        'ID:101',
        undefined,
        '127.0.0.1',
        200,
      );
    });

    it('prioritizes JWT authenticated user over API key header during impersonation or hybrid requests', async () => {
      (req as unknown as { user: { publicKey: string } }).user = {
        publicKey: 'G-IMPERSONATED-USER',
      };
      req.headers = { 'x-api-key': 'admin-api-key-value' };

      auditLog(req as Request, res as Response, next);
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(mockPersist).toHaveBeenCalledWith(
        'G-IMPERSONATED-USER',
        'POST /admin/check-defaults',
        'LoanIDs:[1,2,3]',
        { loanIds: [1, 2, 3] },
        '127.0.0.1',
        200,
      );
    });

    it('extracts client IP from first hop of x-forwarded-for header string', async () => {
      req.ip = '';
      req.headers = {
        'x-api-key': 'key',
        'x-forwarded-for': '203.0.113.195, 70.41.3.18, 150.172.238.178',
      };

      auditLog(req as Request, res as Response, next);
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(mockPersist).toHaveBeenCalledWith(
        'INTERNAL_API_KEY',
        'POST /admin/check-defaults',
        'LoanIDs:[1,2,3]',
        { loanIds: [1, 2, 3] },
        '203.0.113.195',
        200,
      );
    });

    it('extracts client IP from x-forwarded-for header array', async () => {
      req.ip = '';
      req.headers = {
        'x-api-key': 'key',
        'x-forwarded-for': ['198.51.100.42', '10.0.0.1'] as unknown as string,
      };

      auditLog(req as Request, res as Response, next);
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(mockPersist).toHaveBeenCalledWith(
        'INTERNAL_API_KEY',
        'POST /admin/check-defaults',
        'LoanIDs:[1,2,3]',
        { loanIds: [1, 2, 3] },
        '198.51.100.42',
        200,
      );
    });

    it('falls back to socket remoteAddress when ip and forwarded headers are missing', async () => {
      req.ip = '';
      req.headers = { 'x-api-key': 'key' };
      req.socket = { remoteAddress: '192.168.1.100' } as import('net').Socket;

      auditLog(req as Request, res as Response, next);
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(mockPersist).toHaveBeenCalledWith(
        'INTERNAL_API_KEY',
        'POST /admin/check-defaults',
        'LoanIDs:[1,2,3]',
        { loanIds: [1, 2, 3] },
        '192.168.1.100',
        200,
      );
    });

    it('extracts targets from path params and body fields', async () => {
      req.params = { loanId: '456' };
      req.body = { borrowerPublicKey: 'G-BORROWER-KEY' };

      auditLog(req as Request, res as Response, next);
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(mockPersist).toHaveBeenCalledWith(
        'INTERNAL_API_KEY',
        'POST /admin/check-defaults',
        'LoanID:456',
        { borrowerPublicKey: 'G-BORROWER-KEY' },
        '127.0.0.1',
        200,
      );
    });

    it('catches middleware configuration errors and continues request flow', () => {
      const faultyReq = {
        get method() {
          throw new Error('Getter failure');
        },
      } as unknown as Request;

      auditLog(faultyReq, res as Response, next);

      expect(next).toHaveBeenCalled();
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        'Audit log middleware error',
        expect.objectContaining({ err: expect.any(Error) }),
      );
    });
  });
});
