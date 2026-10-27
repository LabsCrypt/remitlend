import { EventEmitter } from 'node:events';
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

const mockQuery = jest.fn<(...args: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number }>>();
const mockLoggerError = jest.fn();

jest.unstable_mockModule('../../db/connection.js', () => ({
  default: { query: mockQuery },
  query: mockQuery,
}));

jest.unstable_mockModule('../../utils/logger.js', () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: mockLoggerError,
    debug: jest.fn(),
  },
}));

const auditLogServiceModule = await import('../auditLogService.js');
const { getAuditLogs, encodeCursor, decodeCursor } = auditLogServiceModule;
const { auditLog } = await import('../../middleware/auditLog.js');

describe('AuditLogService & Middleware — Tamper Resistance, Actor Binding & Rollback Safety (#2062)', () => {
  const originalAllowInTests = process.env.AUDIT_LOG_ALLOW_IN_TESTS;

  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockReset();
    process.env.AUDIT_LOG_ALLOW_IN_TESTS = '1';
  });

  afterEach(() => {
    if (originalAllowInTests === undefined) {
      delete process.env.AUDIT_LOG_ALLOW_IN_TESTS;
    } else {
      process.env.AUDIT_LOG_ALLOW_IN_TESTS = originalAllowInTests;
    }
  });

  describe('Immutable event fields & read-only service surface', () => {
    it('exposes only read and cursor helpers on auditLogService with no update or delete mutators', () => {
      const exportedKeys = Object.keys(auditLogServiceModule).sort();
      expect(exportedKeys).toEqual(['decodeCursor', 'encodeCursor', 'getAuditLogs']);
      expect('updateAuditLog' in auditLogServiceModule).toBe(false);
      expect('deleteAuditLog' in auditLogServiceModule).toBe(false);
    });

    it('rejects tampered or malformed keyset cursors and falls back safely without SQL injection', async () => {
      expect(decodeCursor(undefined)).toBeNull();
      expect(decodeCursor('')).toBeNull();
      expect(decodeCursor('no-separator-at-all')).toBeNull();
      expect(decodeCursor(':only-id')).toBeNull();
      expect(decodeCursor('2026-03-01T00:00:00.000Z:')).toBeNull();
      expect(decodeCursor("not-a-date:123' OR '1'='1")).toBeNull();

      const validRow = {
        id: 42,
        created_at: new Date('2026-03-15T12:30:00.000Z'),
      };
      const encoded = encodeCursor(validRow);
      expect(encoded).toBe('2026-03-15T12:30:00.000Z:42');
      expect(decodeCursor(encoded ?? undefined)).toEqual({
        createdAt: '2026-03-15T12:30:00.000Z',
        id: '42',
      });

      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      await getAuditLogs({
        cursor: "malformed-timestamp:999); DROP TABLE audit_logs; --",
        limit: 10,
      });

      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).not.toContain('(created_at, id) <');
      expect(sql).not.toContain('DROP TABLE');
      expect(params).toEqual([11]);
    });
  });

  describe('Actor identity binding & filter parameterization', () => {
    it('parameterizes actor, action, date range, and cursor filters in both page and count queries', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            {
              id: 71,
              actor: 'GADMIN_STRICT',
              action: 'POST /api/admin/loans/approve',
              target: 'LoanID:42',
              payload: { loanId: 42 },
              ip_address: '198.51.100.7',
              status: 200,
              created_at: new Date('2026-03-01T00:00:00.000Z'),
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ count: '1' }] });

      const untrustedActorInput = "GADMIN_STRICT' OR '1'='1";
      const result = await getAuditLogs({
        actor: untrustedActorInput,
        action: 'POST /api/admin/loans/approve',
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-04-01T00:00:00.000Z',
        cursor: '2026-03-10T00:00:00.000Z:100',
        limit: 10,
        withTotal: true,
      });

      const [pageSql, pageParams] = mockQuery.mock.calls[0] as [string, unknown[]];
      const [countSql, countParams] = mockQuery.mock.calls[1] as [string, unknown[]];

      expect(pageSql).toContain(
        'WHERE actor = $1 AND action = $2 AND created_at >= $3 AND created_at <= $4 AND (created_at, id) < ($5, $6)',
      );
      expect(pageParams).toEqual([
        untrustedActorInput,
        'POST /api/admin/loans/approve',
        '2026-01-01T00:00:00.000Z',
        '2026-04-01T00:00:00.000Z',
        '2026-03-10T00:00:00.000Z',
        '100',
        11,
      ]);

      expect(countSql).toContain(
        'SELECT COUNT(*) as count FROM audit_logs WHERE actor = $1 AND action = $2 AND created_at >= $3 AND created_at <= $4',
      );
      expect(countParams).toEqual([
        untrustedActorInput,
        'POST /api/admin/loans/approve',
        '2026-01-01T00:00:00.000Z',
        '2026-04-01T00:00:00.000Z',
      ]);
      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('binds authenticated req.user.publicKey as actor and snapshots sanitized payload at middleware entry', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const callerBody: Record<string, unknown> = {
        actor: 'GSPOOFED_BODY_ACTOR',
        loanId: 88,
        secret: 'top-secret-webhook-key',
        nested: {
          apiKey: 'raw-api-key',
          signedTxXdr: 'AAAA...XDR',
          note: 'legitimate-note',
        },
      };

      const req = {
        user: { publicKey: 'GVERIFIED_JWT_ADMIN' },
        method: 'POST',
        path: '/api/admin/loans/88/approve',
        params: { loanId: '88' },
        headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' },
        body: callerBody,
        ip: undefined,
        socket: { remoteAddress: '127.0.0.1' },
      } as unknown as Request;

      const emitter = new EventEmitter();
      const res = Object.assign(emitter, { statusCode: 201 }) as unknown as Response;
      const next = jest.fn() as unknown as NextFunction;

      auditLog(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);

      // Mutate req.user and req.body after middleware entry to simulate downstream handler tampering
      (req as unknown as { user: { publicKey: string } }).user = { publicKey: 'GTAMPERED_LATER' };
      callerBody.secret = 'leaked-after-handler';

      emitter.emit('finish');
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];

      expect(sql).toContain('INSERT INTO audit_logs (actor, action, target, payload, ip_address, status)');
      expect(params[0]).toBe('GVERIFIED_JWT_ADMIN');
      expect(params[1]).toBe('POST /api/admin/loans/88/approve');
      expect(params[2]).toBe('LoanID:88');

      const persistedPayload = JSON.parse(params[3] as string) as Record<string, unknown>;
      expect(persistedPayload.secret).toBe('[REDACTED]');
      expect(persistedPayload.nested).toEqual({
        apiKey: '[REDACTED]',
        signedTxXdr: '[REDACTED]',
        note: 'legitimate-note',
      });
      expect(params[4]).toBe('203.0.113.9');
      expect(params[5]).toBe(201);
    });
  });

  describe('Transaction rollback & database failure handling', () => {
    it('discards transactional audit_logs writes when the enclosing database transaction rolls back', async () => {
      const committedAuditRows: unknown[][] = [];
      let txBuffer: unknown[][] = [];

      const txClient = {
        query: jest.fn(async (sql: string, params?: unknown[]) => {
          const normalized = sql.trim().toUpperCase();
          if (normalized === 'BEGIN') {
            txBuffer = [];
            return { rows: [], rowCount: 0 };
          }
          if (normalized === 'ROLLBACK') {
            txBuffer = [];
            return { rows: [], rowCount: 0 };
          }
          if (normalized === 'COMMIT') {
            committedAuditRows.push(...txBuffer);
            txBuffer = [];
            return { rows: [], rowCount: 0 };
          }
          if (normalized.startsWith('INSERT INTO AUDIT_LOGS')) {
            txBuffer.push(params ?? []);
            return { rows: [], rowCount: 1 };
          }
          throw new Error('Loan state update constraint violation');
        }),
      };

      await txClient.query('BEGIN');
      await expect(
        (async () => {
          await txClient.query(
            `INSERT INTO audit_logs (actor, action, target, payload, ip_address, status)
             VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
            ['GADMIN_TX', 'loan_approved', 'loan:42', JSON.stringify({ loanId: 42 }), null, 200],
          );
          await txClient.query('UPDATE loans SET status = $1 WHERE id = $2', ['approved', 42]);
          await txClient.query('COMMIT');
        })(),
      ).rejects.toThrow('Loan state update constraint violation');

      await txClient.query('ROLLBACK');

      expect(committedAuditRows).toHaveLength(0);
    });

    it('logs database rejection errors on audit log persistence without throwing unhandled rejections', async () => {
      mockQuery.mockRejectedValueOnce(new Error('audit_logs write rejected by DB trigger'));

      const req = {
        user: undefined,
        method: 'DELETE',
        path: '/api/admin/webhooks/9',
        params: { id: '9' },
        headers: { 'x-api-key': 'internal-key' },
        body: {},
        ip: '10.0.0.9',
        socket: { remoteAddress: '10.0.0.9' },
      } as unknown as Request;

      const emitter = new EventEmitter();
      const res = Object.assign(emitter, { statusCode: 500 }) as unknown as Response;
      const next = jest.fn() as unknown as NextFunction;

      auditLog(req, res, next);
      emitter.emit('finish');
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockLoggerError).toHaveBeenCalledWith(
        'Audit logging failure',
        expect.objectContaining({
          actor: 'INTERNAL_API_KEY',
          action: 'DELETE /api/admin/webhooks/9',
          target: 'ID:9',
          err: expect.any(Error),
        }),
      );
    });
  });
});
