import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { AuditLogFilters } from '../auditLogService.js';

// getAuditLogs talks to Postgres through query() — mock it so these tests
// assert the SQL it builds (ordering, keyset predicate, filtered count)
// without needing a database.
const mockQuery = jest.fn();
jest.unstable_mockModule('../../db/connection.js', () => ({
  query: mockQuery,
}));

const { getAuditLogs } = await import('../auditLogService.js');

const PAGE_ROWS = [
  { id: '300', created_at: '2026-03-03T00:00:00.000Z' },
  { id: '299', created_at: '2026-03-02T00:00:00.000Z' },
  { id: '298', created_at: '2026-03-01T00:00:00.000Z' },
];

/** The most recent call to query() matching the SELECT page statement. */
const pageQuery = () => {
  const call = [...mockQuery.mock.calls]
    .reverse()
    .find(([text]) => typeof text === 'string' && text.includes('SELECT * FROM audit_logs'));
  return { text: String(call?.[0]), values: (call?.[1] as unknown[]) ?? [] };
};

describe('getAuditLogs keyset pagination and totals (#1808)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockImplementation((text: unknown) => {
      const sql = String(text);
      if (sql.includes('SELECT * FROM audit_logs')) {
        return Promise.resolve({ rows: PAGE_ROWS });
      }
      if (sql.includes('COUNT(*)')) {
        return Promise.resolve({ rows: [{ count: 7 }] });
      }
      return Promise.resolve({ rows: [] });
    });
  });

  describe('ordering matches the cursor', () => {
    it('orders by created_at then id, both descending', async () => {
      await getAuditLogs({ limit: 2 });

      expect(pageQuery().text).toContain('ORDER BY created_at DESC, id DESC');
    });

    it('pages with a (created_at, id) row comparison, not id alone', async () => {
      // Resume from the first page's last row (2026-03-02T00:00:00.000Z:299)
      // so the keyset predicate is actually built.
      await getAuditLogs({ limit: 2, cursor: '2026-03-02T00:00:00.000Z:299' });

      const { text, values } = pageQuery();
      expect(text).toMatch(/\(created_at, id\)\s*<\s*\(\$\d+, \$\d+\)/);
      // The cursor must be both parts, never just the id.
      expect(values).toEqual(expect.arrayContaining(['2026-03-02T00:00:00.000Z', '299']));
      expect(text).not.toMatch(/id\s*<\s*\$\d+\s*\n?\s*AND/);
    });

    it('ignores a malformed cursor rather than paging on garbage', async () => {
      await getAuditLogs({ limit: 2, cursor: 'not-a-cursor' });

      expect(pageQuery().text).not.toMatch(/\(created_at, id\)\s*</);
    });

    it('emits a composite nextCursor', async () => {
      const result = await getAuditLogs({ limit: 2 });

      expect(result.nextCursor).not.toBeNull();
      // The cursor carries the timestamp *and* the id it is paging from.
      expect(result.nextCursor).toContain(':');
      // The cursor carries the timestamp *and* the id it is paging from. The
      // timestamp is an ISO string containing ':' itself, so split on the last
      // separator only.
      const separatorAt = String(result.nextCursor).lastIndexOf(':');
      expect(String(result.nextCursor).slice(0, separatorAt)).toBe('2026-03-02T00:00:00.000Z');
      expect(String(result.nextCursor).slice(separatorAt + 1)).toBe('299');
    });

    it('returns a null cursor on the last page', async () => {
      mockQuery.mockImplementation((text: unknown) =>
        Promise.resolve({
          rows: String(text).includes('SELECT * FROM audit_logs') ? PAGE_ROWS.slice(0, 2) : [],
        }),
      );

      const result = await getAuditLogs({ limit: 2 });
      expect(result.nextCursor).toBeNull();
    });

    it('resumes correctly from a cursor it previously issued', async () => {
      const first = await getAuditLogs({ limit: 2 });
      await getAuditLogs({ limit: 2, cursor: first.nextCursor });

      const { text, values } = pageQuery();
      expect(text).toMatch(/\(created_at, id\)\s*</);
      expect(values).toContain('2026-03-02T00:00:00.000Z');
      expect(values).toContain('299');
    });
  });

  describe('filtered totals', () => {
    it('omits the count query unless withTotal is set', async () => {
      await getAuditLogs({ limit: 2 });

      const countCalls = mockQuery.mock.calls.filter(([text]) => String(text).includes('COUNT(*)'));
      expect(countCalls).toHaveLength(0);
    });

    it('applies the active filters to the count query', async () => {
      mockQuery.mockImplementation((text: unknown) =>
        Promise.resolve({
          rows: String(text).includes('SELECT * FROM audit_logs') ? PAGE_ROWS : [{ count: 3 }],
        }),
      );

      const result = await getAuditLogs({
        actor: 'alice',
        action: 'loan_approved',
        from: '2026-01-01',
        to: '2026-12-31',
        withTotal: true,
        limit: 2,
      });

      const countCall = mockQuery.mock.calls.find(([text]) => String(text).includes('COUNT(*)'));
      const countSql = String(countCall?.[0]);
      const countValues = (countCall?.[1] as unknown[]) ?? [];

      expect(countSql).toContain('WHERE');
      expect(countSql).toContain('actor = $1');
      expect(countSql).toContain('action = $2');
      expect(countSql).toContain('created_at >= $3');
      expect(countSql).toContain('created_at <= $4');
      expect(countValues).toEqual(['alice', 'loan_approved', '2026-01-01', '2026-12-31']);
      expect(result.total).toBe(3);
    });

    it('never lets the count include the keyset cursor', async () => {
      mockQuery.mockImplementation((text: unknown) =>
        Promise.resolve({
          rows: String(text).includes('SELECT * FROM audit_logs') ? PAGE_ROWS : [{ count: 7 }],
        }),
      );

      await getAuditLogs({ withTotal: true, limit: 2, cursor: '2026-03-02T00:00:00.000Z:299' });

      const countSql = String(
        mockQuery.mock.calls.find(([text]) => String(text).includes('COUNT(*)'))?.[0],
      );
      expect(countSql).not.toContain('created_at, id');
    });

    it('counts the whole filtered set, not just the current page', async () => {
      mockQuery.mockImplementation((text: unknown) =>
        Promise.resolve({
          rows: String(text).includes('SELECT * FROM audit_logs') ? PAGE_ROWS : [{ count: 137 }],
        }),
      );

      const result = await getAuditLogs({ withTotal: true, limit: 3, actor: 'alice' });

      expect(result.data).toHaveLength(3);
      expect(result.total).toBe(137);
    });

    it('counts an unfiltered table as a single plain query', async () => {
      // No cursor passed, so the page query carries no keyset predicate and
      // the count SQL is a bare COUNT with no WHERE clause.
      await getAuditLogs({ withTotal: true, limit: 2 });

      const countSql = String(
        mockQuery.mock.calls.find(([text]) => String(text).includes('COUNT(*)'))?.[0],
      );
      expect(countSql.trim()).toBe('SELECT COUNT(*) as count FROM audit_logs');
    });
  });

  describe('limit handling', () => {
    it('requests limit + 1 rows to detect a next page', async () => {
      await getAuditLogs({ limit: 5 });

      const { values } = pageQuery();
      expect(values[values.length - 1]).toBe(6);
    });

    it('trims the probe row out of the data', async () => {
      const result = await getAuditLogs({ limit: 2 });

      expect(result.data).toHaveLength(2);
      expect(result.data.map((r) => r.id)).toEqual(['300', '299']);
    });
  });
});

describe('AuditLogFilters shape (#1808)', () => {
  it('keeps the documented filter surface', () => {
    const filters: AuditLogFilters = {
      actor: 'a',
      action: 'b',
      from: 'c',
      to: 'd',
      cursor: 'e',
      limit: 1,
      withTotal: true,
    };
    expect(Object.keys(filters)).toHaveLength(7);
  });
});
