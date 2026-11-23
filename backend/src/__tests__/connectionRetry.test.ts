import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const mockPoolQuery = jest.fn();
const mockPoolConnect = jest.fn();
const mockLoggerWarn = jest.fn();
const mockLoggerDebug = jest.fn();
const mockLoggerError = jest.fn();
const mockLoggerInfo = jest.fn();

await jest.unstable_mockModule('pg', () => {
  return {
    default: {
      Pool: jest.fn().mockImplementation(() => ({
        query: mockPoolQuery,
        connect: mockPoolConnect,
        on: jest.fn(),
        totalCount: 1,
        idleCount: 1,
        waitingCount: 0,
        end: jest.fn(),
      })),
    },
  };
});

await jest.unstable_mockModule('../utils/logger.js', () => ({
  default: {
    warn: mockLoggerWarn,
    debug: mockLoggerDebug,
    error: mockLoggerError,
    info: mockLoggerInfo,
  },
}));

const { query, queryReadOnly, executeWrite, isDmlStatement } = await import('../db/connection.js');

describe('connection.ts - Transient Retry and Non-Idempotent Writes (#2236)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('isDmlStatement', () => {
    it('identifies bare DML operations correctly', () => {
      expect(isDmlStatement('INSERT INTO contract_events (address) VALUES ($1)')).toBe(true);
      expect(isDmlStatement('  UPDATE scores SET score = 500 WHERE borrower = $1')).toBe(true);
      expect(isDmlStatement('DELETE FROM notifications WHERE id = $1')).toBe(true);
      expect(isDmlStatement('/* comment */ INSERT INTO contract_events VALUES (1)')).toBe(true);
      expect(isDmlStatement('-- comment\nINSERT INTO contract_events VALUES (1)')).toBe(true);
      expect(
        isDmlStatement('WITH new_rows AS (VALUES (1)) INSERT INTO scores SELECT * FROM new_rows'),
      ).toBe(true);
    });

    it('identifies read-only queries correctly', () => {
      expect(isDmlStatement('SELECT * FROM scores WHERE borrower = $1')).toBe(false);
      expect(isDmlStatement('  SELECT score FROM scores')).toBe(false);
      expect(
        isDmlStatement('WITH active_loans AS (SELECT * FROM loans) SELECT * FROM active_loans'),
      ).toBe(false);
      expect(isDmlStatement('SHOW statement_timeout')).toBe(false);
    });
  });

  describe('query() retry behavior', () => {
    it('does NOT retry bare non-idempotent DML writes on transient connection errors to prevent duplicate rows', async () => {
      const transientError = Object.assign(new Error('Connection terminated unexpectedly'), {
        code: '08006',
      });
      mockPoolQuery.mockRejectedValueOnce(transientError);

      const dml = 'INSERT INTO contract_events (address, amount) VALUES ($1, $2)';
      await expect(query(dml, ['G_BORROWER', 1000])).rejects.toThrow(
        'Connection terminated unexpectedly',
      );

      // Must NOT be retried: called exactly once, preventing double event insertion
      expect(mockPoolQuery).toHaveBeenCalledTimes(1);
    });

    it('retries read-only queries on transient errors and succeeds upon retry', async () => {
      const transientError = Object.assign(new Error('Connection refused'), {
        code: 'ECONNREFUSED',
      });
      mockPoolQuery
        .mockRejectedValueOnce(transientError)
        .mockResolvedValueOnce({ rows: [{ score: 700 }], rowCount: 1 });

      const readSql = 'SELECT score FROM scores WHERE borrower = $1';
      const result = await query(readSql, ['G_BORROWER']);

      expect(mockPoolQuery).toHaveBeenCalledTimes(2);
      expect(result.rows).toEqual([{ score: 700 }]);
    });

    it('queryReadOnly forces retry for queries', async () => {
      const transientError = Object.assign(new Error('Connection reset'), {
        code: '08006',
      });
      mockPoolQuery
        .mockRejectedValueOnce(transientError)
        .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 });

      const result = await queryReadOnly('SELECT id FROM loans');
      expect(mockPoolQuery).toHaveBeenCalledTimes(2);
      expect(result.rows).toEqual([{ id: 1 }]);
    });

    it('executeWrite prevents retry for mutating queries', async () => {
      const transientError = Object.assign(new Error('Admin shutdown'), {
        code: '57P01',
      });
      mockPoolQuery.mockRejectedValueOnce(transientError);

      await expect(
        executeWrite('UPDATE scores SET score = $1 WHERE borrower = $2', [720, 'G_ADDR']),
      ).rejects.toThrow('Admin shutdown');

      expect(mockPoolQuery).toHaveBeenCalledTimes(1);
    });
  });
});
