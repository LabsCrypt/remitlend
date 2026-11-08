import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import type { Request, Response } from 'express';
import express from 'express';
import request from 'supertest';
import logger from '../../utils/logger.js';

// Mock DB connection query runner
const mockQuery = jest.fn<(...args: unknown[]) => Promise<{ rows: unknown[] }>>().mockResolvedValue({ rows: [] });

await jest.unstable_mockModule('../../db/connection.js', () => ({
  default: { query: mockQuery },
  query: mockQuery,
}));

const { auditLog } = await import('../auditLog.js');

describe('Audit Middleware Actor Attribution & Resilience Suite (#2098)', () => {
  let loggerErrorSpy: jest.SpyInstance;
  let loggerWarnSpy: jest.SpyInstance;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    // Enable audit logging in test environment
    process.env.AUDIT_LOG_ALLOW_IN_TESTS = '1';

    loggerErrorSpy = jest.spyOn(logger, 'error').mockImplementation(() => logger);
    loggerWarnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => logger);
  });

  afterEach(() => {
    process.env = originalEnv;
    loggerErrorSpy.mockRestore();
    loggerWarnSpy.mockRestore();
  });

  /* ─────────────────────────────────────────────────────────────
   * 1. Actor Attribution (Authenticated, API Key & Anonymous)
   * ───────────────────────────────────────────────────────────── */
  describe('Actor Attribution', () => {
    it('attributes action to authenticated JWT user public key', async () => {
      const app = express();
      app.use(express.json());

      const authenticate = (req: any, _res: any, next: any) => {
        req.user = { publicKey: 'G_STELLAR_BORROWER_PUBLIC_KEY_1234' };
        next();
      };

      app.post('/api/loans/:loanId/repay', authenticate, auditLog, (_req, res) => {
        res.status(200).json({ success: true });
      });

      const res = await request(app)
        .post('/api/loans/LN-888/repay')
        .send({ amount: 1500 });

      expect(res.status).toBe(200);

      // Wait a tick for res.on('finish') async persistence
      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const [sql, params] = (mockQuery as jest.Mock).mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO audit_logs');
      expect(params[0]).toBe('G_STELLAR_BORROWER_PUBLIC_KEY_1234'); // Actor
      expect(params[1]).toBe('POST /api/loans/LN-888/repay'); // Action
      expect(params[2]).toBe('LoanID:LN-888'); // Target from route params
      expect(params[5]).toBe(200); // StatusCode
    });

    it('attributes action to INTERNAL_API_KEY when x-api-key header is provided without user', async () => {
      const app = express();
      app.use(express.json());
      app.use(auditLog);

      app.get('/api/admin/system-health', (_req, res) => {
        res.status(200).json({ status: 'healthy' });
      });

      const res = await request(app)
        .get('/api/admin/system-health')
        .set('x-api-key', 'super-secret-service-key');

      expect(res.status).toBe(200);

      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const params = (mockQuery as jest.Mock).mock.calls[0][1] as unknown[];
      expect(params[0]).toBe('INTERNAL_API_KEY');
      expect(params[1]).toBe('GET /api/admin/system-health');
    });

    it('attributes action to unknown for anonymous unauthenticated requests', async () => {
      const app = express();
      app.use(express.json());
      app.use(auditLog);

      app.get('/api/public/rates', (_req, res) => {
        res.status(200).json({ rate: 1.05 });
      });

      const res = await request(app).get('/api/public/rates');

      expect(res.status).toBe(200);

      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const params = (mockQuery as jest.Mock).mock.calls[0][1] as unknown[];
      expect(params[0]).toBe('unknown');
    });

    it('attributes action to impersonated/delegated user publicKey when set by admin middleware', async () => {
      const app = express();
      app.use(express.json());

      app.use((req, _res, next) => {
        (req as any).user = {
          publicKey: 'G_IMPERSONATED_CLIENT_WALLET_9999',
          impersonatedBy: 'G_ADMIN_SUPERVISOR_1111',
        };
        next();
      });
      app.use(auditLog);

      app.post('/api/borrower/profile', (_req, res) => {
        res.status(201).json({ updated: true });
      });

      const res = await request(app).post('/api/borrower/profile').send({ country: 'PH' });

      expect(res.status).toBe(201);

      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const params = (mockQuery as jest.Mock).mock.calls[0][1] as unknown[];
      expect(params[0]).toBe('G_IMPERSONATED_CLIENT_WALLET_9999');
    });
  });

  /* ─────────────────────────────────────────────────────────────
   * 2. Target Extraction & Payload Sanitization
   * ───────────────────────────────────────────────────────────── */
  describe('Target Extraction & Payload Sanitization', () => {
    it('extracts target from request body fields (loanIds, publicKey, address)', async () => {
      const app = express();
      app.use(express.json());
      app.use(auditLog);

      app.post('/api/loans/batch-verify', (_req, res) => {
        res.status(200).json({ processed: true });
      });

      await request(app)
        .post('/api/loans/batch-verify')
        .send({ loanIds: ['LN-01', 'LN-02', 'LN-03'] });

      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const params = (mockQuery as jest.Mock).mock.calls[0][1] as unknown[];
      expect(params[2]).toBe('LoanIDs:[LN-01,LN-02,LN-03]');
    });

    it('redacts sensitive credentials (apiKey, password, token, signedTx, secret) from payload', async () => {
      const app = express();
      app.use(express.json());
      app.use(auditLog);

      app.post('/api/escrow/disburse', (_req, res) => {
        res.status(200).json({ success: true });
      });

      await request(app)
        .post('/api/escrow/disburse')
        .send({
          escrowId: 'ESC-777',
          amount: 500,
          apiKey: 'super-secret-key-to-redact',
          password: 'my-plaintext-password',
          secret: 'shhh-confidential',
          token: 'bearer-token-here',
          signedTx: 'AAAA...stellar-xdr...',
          signedTxXdr: 'AAAA...stellar-xdr...',
          nestedConfig: {
            apiKey: 'nested-key-to-redact',
            label: 'production',
          },
        });

      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const params = (mockQuery as jest.Mock).mock.calls[0][1] as unknown[];
      const loggedPayload = JSON.parse(params[3] as string);

      expect(loggedPayload.amount).toBe(500);
      expect(loggedPayload.apiKey).toBe('[REDACTED]');
      expect(loggedPayload.password).toBe('[REDACTED]');
      expect(loggedPayload.secret).toBe('[REDACTED]');
      expect(loggedPayload.token).toBe('[REDACTED]');
      expect(loggedPayload.signedTx).toBe('[REDACTED]');
      expect(loggedPayload.signedTxXdr).toBe('[REDACTED]');
      expect(loggedPayload.nestedConfig.apiKey).toBe('[REDACTED]');
      expect(loggedPayload.nestedConfig.label).toBe('production');
    });

    it('resolves client IP correctly when proxy headers are present', async () => {
      const app = express();
      app.set('trust proxy', true);
      app.use(express.json());
      app.use(auditLog);

      app.get('/api/test-ip', (_req, res) => {
        res.status(200).json({ ok: true });
      });

      await request(app)
        .get('/api/test-ip')
        .set('x-forwarded-for', '203.0.113.195, 70.41.3.18');

      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const params = (mockQuery as jest.Mock).mock.calls[0][1] as unknown[];
      expect(params[4]).toBe('203.0.113.195');
    });
  });

  /* ─────────────────────────────────────────────────────────────
   * 3. Failed Writes & Error Resilience (Database & Timeout)
   * ───────────────────────────────────────────────────────────── */
  describe('Resilience Against Failed Writes & Errors', () => {
    it('catches database query failure on finish and logs error without failing request', async () => {
      mockQuery.mockRejectedValueOnce(new Error('PostgreSQL database disk full'));

      const app = express();
      app.use(express.json());
      app.use(auditLog);

      app.post('/api/action', (_req, res) => {
        res.status(200).json({ completed: true });
      });

      const res = await request(app).post('/api/action').send({ test: true });

      // Request still succeeds for the client
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ completed: true });

      await new Promise((resolve) => setTimeout(resolve, 60));

      // Logger caught the failure asynchronously
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Audit logging failure',
        expect.objectContaining({
          err: expect.any(Error),
          action: 'POST /api/action',
        })
      );
    });

    it('handles database write timeout gracefully without hanging the application', async () => {
      // Simulate hanging database query
      mockQuery.mockImplementationOnce(() => new Promise(() => {}));

      const app = express();
      app.use(express.json());
      app.use(auditLog);

      app.get('/api/slow-log', (_req, res) => {
        res.status(200).json({ done: true });
      });

      const res = await request(app).get('/api/slow-log');
      expect(res.status).toBe(200);

      // Wait for default timeout (750ms + margin)
      await new Promise((resolve) => setTimeout(resolve, 850));

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Audit logging failure',
        expect.objectContaining({
          err: expect.objectContaining({
            message: expect.stringContaining('Audit log insert timed out after'),
          }),
        })
      );
    });

    it('catches synchronous errors in auditLog middleware and proceeds with request', () => {
      const badReq = {
        get method() {
          throw new Error('Getter accessor crash');
        },
      } as unknown as Request;
      const mockRes = {} as Response;
      const mockNext = jest.fn();

      auditLog(badReq, mockRes, mockNext as any);

      expect(loggerWarnSpy).toHaveBeenCalledWith(
        'Audit log middleware error',
        expect.objectContaining({
          err: expect.any(Error),
        })
      );
      expect(mockNext).toHaveBeenCalledTimes(1);
    });
  });
});
