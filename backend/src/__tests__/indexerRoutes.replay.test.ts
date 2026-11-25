/**
 * Replay and checkpoint coverage for indexerRoutes (#2104).
 *
 * Exercises the real indexer controller behind the router with a mocked DB:
 *   - checkpoint reporting on /status, including a missing or stale checkpoint
 *   - keyset replay: snapshot pinning, created_at ties broken by seq, and
 *     conflicting replays (same cursor, different snapshots) staying isolated
 *   - limit boundaries and malformed replay parameters
 *   - JWT, wallet-ownership, loan-ownership and API-key scope checks
 */
import express, { type Express } from 'express';
import request from 'supertest';
import { describe, it, expect, jest, beforeEach, afterAll } from '@jest/globals';

process.env.JWT_SECRET = 'test-jwt-secret-min-32-chars-long!!';
process.env.INTERNAL_API_KEY = 'admin:indexer:indexer-value,admin:webhooks:webhook-value';

type QueryResult = { rows: Record<string, unknown>[]; rowCount?: number };

const mockQuery = jest.fn<(text: string, params?: unknown[]) => Promise<QueryResult>>();

jest.unstable_mockModule('../db/connection.js', () => ({
  query: mockQuery,
  getClient: jest.fn(),
  withTransaction: jest.fn(),
  default: { query: mockQuery },
}));

const fakeCacheStore = new Map<string, unknown>();
jest.unstable_mockModule('../services/cacheService.js', () => ({
  cacheService: {
    get: jest.fn(async (key: string) => fakeCacheStore.get(key) ?? null),
    set: jest.fn(async (key: string, value: unknown) => {
      fakeCacheStore.set(key, value);
    }),
    delete: jest.fn(async (key: string) => {
      fakeCacheStore.delete(key);
    }),
    ping: jest.fn(async () => 'ok'),
  },
}));

const { default: indexerRoutes } = await import('../routes/indexerRoutes.js');
const { errorHandler } = await import('../middleware/errorHandler.js');
const { generateJwtToken } = await import('../services/authService.js');
const { encodeCursor, decodeCursor } = await import('../utils/pagination.js');

const BORROWER = 'GBORROWERINDEXERREPLAY';
const OTHER = 'GOTHERINDEXERREPLAY';

const buildApp = (): Express => {
  const app = express();
  app.use(express.json());
  app.use('/api/indexer', indexerRoutes);
  app.use(errorHandler);
  return app;
};

const app = buildApp();

const bearer = (publicKey: string) => ({
  Authorization: `Bearer ${generateJwtToken(publicKey)}`,
});

const eventRow = (seq: number, createdAt: string) => ({
  event_id: `evt-${seq}`,
  event_type: 'LoanRepaid',
  loan_id: 7,
  address: BORROWER,
  amount: '100',
  ledger: 1000 + seq,
  ledger_closed_at: createdAt,
  tx_hash: `tx-${seq}`,
  created_at: createdAt,
  id: seq,
  seq: String(seq),
});

interface DbFixture {
  maxSeq?: string | null;
  page?: Record<string, unknown>[];
  total?: string;
  loanOwner?: string | null;
}

const useDb = ({
  maxSeq = '900',
  page = [],
  total = '0',
  loanOwner = BORROWER,
}: DbFixture = {}) => {
  mockQuery.mockImplementation(async (text: string) => {
    if (text.includes('MAX(seq)')) return { rows: [{ max_seq: maxSeq }] };
    if (text.includes('COUNT(*) as count')) return { rows: [{ count: total }] };
    if (text.includes('ORDER BY created_at DESC')) return { rows: page };
    if (text.includes("event_type IN ('LoanRequested', 'LoanApproved')")) {
      return { rows: loanOwner ? [{ address: loanOwner }] : [] };
    }
    return { rows: [] };
  });
};

const pageQueryParams = (): unknown[] => {
  const call = mockQuery.mock.calls.find(([text]) => text.includes('ORDER BY created_at DESC'));
  return call?.[1] ?? [];
};

const pageQueries = () =>
  mockQuery.mock.calls.filter(([text]) => text.includes('ORDER BY created_at DESC'));

beforeEach(() => {
  mockQuery.mockReset();
  fakeCacheStore.clear();
});

afterAll(() => {
  delete process.env.JWT_SECRET;
  delete process.env.INTERNAL_API_KEY;
});

describe('GET /api/indexer/status checkpoints', () => {
  it('requires an API key', async () => {
    const res = await request(app).get('/api/indexer/status');

    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects a key without the admin:indexer scope', async () => {
    const res = await request(app).get('/api/indexer/status').set('x-api-key', 'webhook-value');

    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('serves event counts from the cache on subsequent requests', async () => {
    mockQuery.mockImplementation(async (text: string) => {
      if (text.includes('FROM indexer_state')) {
        return {
          rows: [
            {
              last_indexed_ledger: 4200,
              last_indexed_cursor: '4200-1',
              updated_at: '2026-10-01T00:00:00.000Z',
            },
          ],
        };
      }
      if (text.includes('GROUP BY event_type')) {
        return { rows: [{ event_type: 'LoanRepaid', count: '2' }] };
      }
      return { rows: [{ total: '2' }] };
    });

    const aggregateCalls = () =>
      mockQuery.mock.calls.filter(([text]) => text.includes('GROUP BY event_type')).length;

    await request(app).get('/api/indexer/status').set('x-api-key', 'indexer-value');
    const afterFirstRequest = aggregateCalls();

    await request(app).get('/api/indexer/status').set('x-api-key', 'indexer-value');

    expect(afterFirstRequest).toBe(1);
    expect(aggregateCalls()).toBe(1);
  });

  it('reports the latest checkpoint and per-type counts', async () => {
    mockQuery.mockImplementation(async (text: string) => {
      if (text.includes('FROM indexer_state')) {
        return {
          rows: [
            {
              last_indexed_ledger: 4200,
              last_indexed_cursor: '4200-1',
              updated_at: '2026-10-01T00:00:00.000Z',
            },
          ],
        };
      }
      if (text.includes('GROUP BY event_type')) {
        return {
          rows: [
            { event_type: 'LoanRequested', count: '3' },
            { event_type: 'LoanRepaid', count: '2' },
          ],
        };
      }
      return { rows: [{ total: '5' }] };
    });

    const res = await request(app).get('/api/indexer/status').set('x-api-key', 'indexer-value');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: {
        lastIndexedLedger: 4200,
        lastIndexedCursor: '4200-1',
        lastUpdated: '2026-10-01T00:00:00.000Z',
        totalEvents: 5,
        eventsByType: { LoanRequested: 3, LoanRepaid: 2 },
      },
    });
  });

  it('returns a stale checkpoint verbatim without rewriting it', async () => {
    mockQuery.mockImplementation(async (text: string) => {
      if (text.includes('FROM indexer_state')) {
        return {
          rows: [
            {
              last_indexed_ledger: 1,
              last_indexed_cursor: null,
              updated_at: '2020-01-01T00:00:00Z',
            },
          ],
        };
      }
      if (text.includes('GROUP BY event_type')) return { rows: [] };
      return { rows: [{ total: '0' }] };
    });

    const res = await request(app).get('/api/indexer/status').set('x-api-key', 'indexer-value');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      lastIndexedLedger: 1,
      lastIndexedCursor: null,
      lastUpdated: '2020-01-01T00:00:00Z',
      totalEvents: 0,
      eventsByType: {},
    });
    // Status is a read-only probe: it must never write to the checkpoint table.
    expect(mockQuery.mock.calls.every(([text]) => !/\b(UPDATE|INSERT)\b/.test(text))).toBe(true);
  });

  it('returns 404 when no checkpoint exists yet', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const res = await request(app).get('/api/indexer/status').set('x-api-key', 'indexer-value');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, message: 'Indexer state not found' });
  });

  it('returns 500 when the checkpoint read fails', async () => {
    mockQuery.mockRejectedValue(new Error('db down'));

    const res = await request(app).get('/api/indexer/status').set('x-api-key', 'indexer-value');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, message: 'Failed to get indexer status' });
  });
});

describe('GET /api/indexer/events/borrower/:borrower replay', () => {
  it('pins the snapshot to MAX(seq) on the first page', async () => {
    useDb({ maxSeq: '900', page: [eventRow(5, '2026-10-01T00:00:00.000Z')], total: '1' });

    const res = await request(app)
      .get(`/api/indexer/events/borrower/${BORROWER}`)
      .set(bearer(BORROWER));

    expect(res.status).toBe(200);
    expect(res.body.page).toEqual({
      next_cursor: null,
      snapshot_seq: '900',
      total_at_snapshot: 1,
      limit: 50,
    });
    expect(pageQueryParams()).toEqual([BORROWER, '900', 51]);
  });

  it('pins snapshot 0 when the events table is empty', async () => {
    useDb({ maxSeq: null });

    const res = await request(app)
      .get(`/api/indexer/events/borrower/${BORROWER}`)
      .set(bearer(BORROWER));

    expect(res.status).toBe(200);
    expect(res.body.data.items).toEqual([]);
    expect(res.body.page.snapshot_seq).toBe('0');
    expect(res.body.page.next_cursor).toBeNull();
  });

  it('reuses a client snapshot instead of re-pinning to newer events', async () => {
    useDb({ maxSeq: '999' });

    const res = await request(app)
      .get(`/api/indexer/events/borrower/${BORROWER}?snapshot_seq=400`)
      .set(bearer(BORROWER));

    expect(res.status).toBe(200);
    expect(res.body.page.snapshot_seq).toBe('400');
    expect(mockQuery.mock.calls.some(([text]) => text.includes('MAX(seq)'))).toBe(false);
    expect(pageQueryParams()).toEqual([BORROWER, '400', 51]);
  });

  it('breaks created_at ties by seq when building the next cursor', async () => {
    const tie = '2026-10-01T12:00:00.000Z';
    useDb({ page: [eventRow(30, tie), eventRow(20, tie), eventRow(10, tie)], total: '3' });

    const res = await request(app)
      .get(`/api/indexer/events/borrower/${BORROWER}?limit=2`)
      .set(bearer(BORROWER));

    expect(res.status).toBe(200);
    expect(res.body.data.items.map((e: { seq: string }) => e.seq)).toEqual(['30', '20']);

    const cursor = decodeCursor(res.body.page.next_cursor);
    expect(cursor.createdAt.toISOString()).toBe(tie);
    expect(cursor.seq).toBe(20n);
  });

  it('applies the keyset tie-breaker when replaying from a cursor', async () => {
    const tie = '2026-10-01T12:00:00.000Z';
    useDb({ page: [eventRow(10, tie)], total: '3' });
    const cursor = encodeCursor(new Date(tie), 20n);

    const res = await request(app)
      .get(`/api/indexer/events/borrower/${BORROWER}?snapshot_seq=900&cursor=${cursor}&limit=2`)
      .set(bearer(BORROWER));

    expect(res.status).toBe(200);
    const [text, params] = pageQueries()[0]!;
    expect(text).toContain('(created_at < $3 OR (created_at = $4 AND seq < $5))');
    expect(params).toEqual([BORROWER, '900', tie, tie, '20', 3]);
    expect(res.body.page.next_cursor).toBeNull();
  });

  it('keeps conflicting replays of the same cursor isolated by snapshot', async () => {
    const tie = '2026-10-01T12:00:00.000Z';
    useDb({ page: [] });
    const cursor = encodeCursor(new Date(tie), 20n);
    const path = `/api/indexer/events/borrower/${BORROWER}?cursor=${cursor}&limit=2`;

    const [older, newer, repeat] = await Promise.all([
      request(app).get(`${path}&snapshot_seq=100`).set(bearer(BORROWER)),
      request(app).get(`${path}&snapshot_seq=200`).set(bearer(BORROWER)),
      request(app).get(`${path}&snapshot_seq=100`).set(bearer(BORROWER)),
    ]);

    expect(older.body.page.snapshot_seq).toBe('100');
    expect(newer.body.page.snapshot_seq).toBe('200');
    expect(repeat.body).toEqual(older.body);

    const snapshots = pageQueries()
      .map(([, params]) => (params as unknown[])[1])
      .sort();
    expect(snapshots).toEqual(['100', '100', '200']);
  });

  it('returns no next cursor when the page is exactly full', async () => {
    useDb({
      page: [eventRow(2, '2026-10-02T00:00:00.000Z'), eventRow(1, '2026-10-01T00:00:00.000Z')],
      total: '2',
    });

    const res = await request(app)
      .get(`/api/indexer/events/borrower/${BORROWER}?limit=2`)
      .set(bearer(BORROWER));

    expect(res.body.data.items).toHaveLength(2);
    expect(res.body.page.next_cursor).toBeNull();
  });

  it('caps limit at 100 and falls back to 50 for invalid limits', async () => {
    useDb();

    const capped = await request(app)
      .get(`/api/indexer/events/borrower/${BORROWER}?limit=5000`)
      .set(bearer(BORROWER));
    expect(capped.body.page.limit).toBe(100);

    mockQuery.mockClear();
    const fallback = await request(app)
      .get(`/api/indexer/events/borrower/${BORROWER}?limit=0`)
      .set(bearer(BORROWER));
    expect(fallback.body.page.limit).toBe(50);
  });

  it('rejects a malformed cursor with the controller error envelope', async () => {
    useDb();

    const res = await request(app)
      .get(`/api/indexer/events/borrower/${BORROWER}?cursor=not-a-cursor`)
      .set(bearer(BORROWER));

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, message: 'Failed to get borrower events' });
    expect(pageQueries()).toHaveLength(0);
  });

  it('rejects a malformed snapshot_seq with the controller error envelope', async () => {
    useDb();

    const res = await request(app)
      .get(`/api/indexer/events/borrower/${BORROWER}?snapshot_seq=abc`)
      .set(bearer(BORROWER));

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, message: 'Failed to get borrower events' });
  });

  it('requires a JWT', async () => {
    const res = await request(app).get(`/api/indexer/events/borrower/${BORROWER}`);
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects replaying another borrower's events", async () => {
    const res = await request(app)
      .get(`/api/indexer/events/borrower/${OTHER}`)
      .set(bearer(BORROWER));

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('GET /api/indexer/events/loan/:loanId replay', () => {
  it('replays events for a loan the caller owns', async () => {
    useDb({ page: [eventRow(1, '2026-10-01T00:00:00.000Z')], total: '1' });

    const res = await request(app).get('/api/indexer/events/loan/7').set(bearer(BORROWER));

    expect(res.status).toBe(200);
    expect(res.body.data.loanId).toBe(7);
    expect(res.body.data.items).toHaveLength(1);
    expect(pageQueryParams()).toEqual(['7', '900', 51]);
  });

  it('returns 404 when the loan has no indexed events', async () => {
    useDb({ loanOwner: null });

    const res = await request(app).get('/api/indexer/events/loan/7').set(bearer(BORROWER));

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Loan not found');
  });

  it("returns 403 for another borrower's loan", async () => {
    useDb({ loanOwner: OTHER });

    const res = await request(app).get('/api/indexer/events/loan/7').set(bearer(BORROWER));

    expect(res.status).toBe(403);
    expect(pageQueries()).toHaveLength(0);
  });

  it('returns 400 for a non-numeric loan id', async () => {
    const res = await request(app).get('/api/indexer/events/loan/abc').set(bearer(BORROWER));

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Invalid loan ID');
  });
});

describe('GET /api/indexer/events/recent replay', () => {
  it('requires an API key', async () => {
    const res = await request(app).get('/api/indexer/events/recent');
    expect(res.status).toBe(401);
  });

  it('rejects a key without the admin:indexer scope', async () => {
    const res = await request(app)
      .get('/api/indexer/events/recent')
      .set('x-api-key', 'webhook-value');
    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('replays recent events with an admin:indexer key', async () => {
    useDb({ page: [eventRow(3, '2026-10-01T00:00:00.000Z')], total: '1' });

    const res = await request(app)
      .get('/api/indexer/events/recent?snapshot_seq=50')
      .set('x-api-key', 'indexer-value');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(pageQueryParams()).toEqual(['50', 51]);
  });
});
