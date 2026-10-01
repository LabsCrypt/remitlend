import request from 'supertest';
import { jest } from '@jest/globals';
import { Keypair } from '@stellar/stellar-sdk';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-jwt-secret-min-32-chars-long!!';

const USER_A = Keypair.random().publicKey();
const USER_B = Keypair.random().publicKey();

const mockQuery =
  jest.fn<(sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>>();

jest.unstable_mockModule('../db/connection.js', () => ({
  default: { query: mockQuery },
  query: mockQuery,
  getClient: jest.fn(),
  closePool: jest.fn(),
  withTransaction: jest.fn(),
}));

const mockCreateNotification = jest.fn();
jest.unstable_mockModule('../services/notificationService.js', () => ({
  notificationService: {
    createNotification: mockCreateNotification,
  },
}));

jest.unstable_mockModule('../services/sorobanService.js', () => ({
  sorobanService: {
    submitSignedTx: jest.fn(),
  },
}));

const fakeCacheStore = new Map<string, unknown>();
jest.unstable_mockModule('../services/cacheService.js', () => ({
  cacheService: {
    get: jest.fn(async (key: string) => fakeCacheStore.get(key) ?? null),
    set: jest.fn(async (key: string, value: unknown) => {
      fakeCacheStore.set(key, value);
    }),
    setNotExists: jest.fn(async (key: string, value: unknown) => {
      if (fakeCacheStore.has(key)) return false;
      fakeCacheStore.set(key, value);
      return true;
    }),
    delete: jest.fn(async (key: string) => {
      fakeCacheStore.delete(key);
    }),
  },
}));

const { default: app } = await import('../app.js');

const createAuthToken = (publicKey: string, scopes: string[] = ['read:remittances']) => {
  return jwt.sign({ publicKey, role: 'borrower', scopes }, process.env.JWT_SECRET!, {
    algorithm: 'HS256',
    expiresIn: '1h',
  });
};

// ── In-memory simulation of the transaction_submissions table ────────────────
interface TxRow {
  id: number;
  tx_hash: string;
  status: string;
  submitted_at: string;
  submitted_by: string;
  transaction_type: string;
  result_xdr: string;
}

let table: TxRow[] = [];
let lastSql = '';
let lastParams: unknown[] = [];

function txRow(id: number, submittedBy: string): TxRow {
  return {
    id,
    tx_hash: `tx-hash-${id}`,
    status: 'success',
    submitted_at: new Date(Date.UTC(2026, 0, 1) - id * 60_000).toISOString(),
    submitted_by: submittedBy,
    transaction_type: 'payment',
    result_xdr: `xdr-${id}`,
  };
}

// Mimics the controller's query shape: $1 = submitted_by, $2 = limit + 1,
// optional $3 = cursor (AND id < $3), ORDER BY id DESC.
const simulateQuery = async (
  sql: string,
  params: unknown[] = [],
): Promise<{ rows: unknown[]; rowCount: number }> => {
  lastSql = sql;
  lastParams = params;

  const submittedBy = params[0] as string;
  const fetchCount = Number(params[1]);
  const cursor = params.length > 2 ? Number(params[2]) : null;

  let rows = table.filter((row) => row.submitted_by === submittedBy);
  if (cursor !== null) {
    rows = rows.filter((row) => row.id < cursor);
  }
  rows = rows.sort((a, b) => b.id - a.id).slice(0, fetchCount);

  return { rows, rowCount: rows.length };
};

mockQuery.mockImplementation(simulateQuery);

const normalizeSql = (sql: string): string => sql.replace(/\s+/g, ' ');

beforeEach(() => {
  jest.clearAllMocks();
  table = [];
  lastSql = '';
  lastParams = [];
  mockQuery.mockImplementation(simulateQuery);
});

describe('GET /api/transactions/me (listMyTransactions)', () => {
  describe('authentication', () => {
    it('returns 401 when Authorization header is missing', async () => {
      const res = await request(app).get('/api/transactions/me');

      expect(res.status).toBe(401);
      expect(res.body.message).toContain('Missing or invalid Authorization header');
    });

    it('returns 401 for an invalid token', async () => {
      const res = await request(app)
        .get('/api/transactions/me')
        .set('Authorization', 'Bearer not-a-real-jwt');

      expect(res.status).toBe(401);
      expect(res.body.message).toContain('Invalid or expired');
    });

    it('returns 200 with a valid JWT token', async () => {
      table = [txRow(1, USER_A)];

      const res = await request(app)
        .get('/api/transactions/me')
        .set('Authorization', `Bearer ${createAuthToken(USER_A)}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('default-limit first page', () => {
    it('returns up to 20 rows with camelCase fields and correct page_info', async () => {
      // 25 rows for USER_A plus 3 rows for USER_B: the default-limit probe must
      // fetch limit+1 (21) rows so the controller can compute has_next.
      table = [
        ...Array.from({ length: 25 }, (_, i) => txRow(125 - i, USER_A)),
        ...[90, 89, 88].map((id) => txRow(id, USER_B)),
      ];

      const res = await request(app)
        .get('/api/transactions/me')
        .set('Authorization', `Bearer ${createAuthToken(USER_A)}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(20);
      expect(res.body.page_info).toEqual(
        expect.objectContaining({
          limit: 20,
          count: 20,
          next_cursor: '106',
          has_previous: false,
          has_next: true,
        }),
      );

      // Snake_case DB columns are mapped to camelCase API fields.
      expect(res.body.data[0]).toEqual({
        id: 125,
        txHash: 'tx-hash-125',
        status: 'success',
        submittedAt: txRow(125, USER_A).submitted_at,
        submittedBy: USER_A,
        transactionType: 'payment',
        resultXdr: 'xdr-125',
      });
      expect(res.body.data[19].id).toBe(106);

      // Query is scoped to the authenticated wallet and probes limit+1 rows.
      expect(lastParams[0]).toBe(USER_A);
      expect(lastParams[1]).toBe(21);
      expect(normalizeSql(lastSql)).toContain('WHERE submitted_by = $1');
      expect(normalizeSql(lastSql)).not.toContain('AND id < $3');
    });
  });

  describe('cursor pagination', () => {
    it('walks multiple pages without duplicating or skipping rows', async () => {
      table = [5, 4, 3, 2, 1].map((id) => txRow(id, USER_A));

      const token = createAuthToken(USER_A);

      // Page 1: no cursor.
      const page1 = await request(app)
        .get('/api/transactions/me?limit=2')
        .set('Authorization', `Bearer ${token}`);

      expect(page1.status).toBe(200);
      expect(page1.body.data.map((row: { id: number }) => row.id)).toEqual([5, 4]);
      expect(page1.body.page_info).toEqual(
        expect.objectContaining({
          limit: 2,
          count: 2,
          next_cursor: '4',
          has_previous: false,
          has_next: true,
        }),
      );
      expect(lastParams).toEqual([USER_A, 3]);

      // Page 2: cursor from page 1.
      const page2 = await request(app)
        .get('/api/transactions/me?limit=2&cursor=4')
        .set('Authorization', `Bearer ${token}`);

      expect(page2.status).toBe(200);
      expect(normalizeSql(lastSql)).toContain('AND id < $3');
      expect(lastParams).toEqual([USER_A, 3, 4]);
      expect(page2.body.data.map((row: { id: number }) => row.id)).toEqual([3, 2]);
      expect(page2.body.page_info).toEqual(
        expect.objectContaining({
          next_cursor: '2',
          has_previous: true,
          has_next: true,
        }),
      );

      // Page 3: cursor from page 2 — last page.
      const page3 = await request(app)
        .get('/api/transactions/me?limit=2&cursor=2')
        .set('Authorization', `Bearer ${token}`);

      expect(page3.status).toBe(200);
      expect(lastParams).toEqual([USER_A, 3, 2]);
      expect(page3.body.data.map((row: { id: number }) => row.id)).toEqual([1]);
      expect(page3.body.page_info).toEqual(
        expect.objectContaining({
          next_cursor: null,
          has_previous: true,
          has_next: false,
        }),
      );

      // The full walk covers every row exactly once, newest first.
      const allIds = [...page1.body.data, ...page2.body.data, ...page3.body.data].map(
        (row: { id: number }) => row.id,
      );
      expect(allIds).toEqual([5, 4, 3, 2, 1]);
    });
  });

  describe('invalid / malformed cursor', () => {
    it.each(['abc', '0', '-1', ''])(
      'treats cursor=%p as absent instead of erroring or leaking rows',
      async (cursor) => {
        table = [5, 4, 3, 2, 1].map((id) => txRow(id, USER_A));

        const res = await request(app)
          .get(`/api/transactions/me?cursor=${encodeURIComponent(cursor)}`)
          .set('Authorization', `Bearer ${createAuthToken(USER_A)}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        // No cursor clause and no $3 param: behaves like a first page.
        expect(normalizeSql(lastSql)).not.toContain('AND id < $3');
        expect(lastParams).toHaveLength(2);
        expect(res.body.page_info).toEqual(
          expect.objectContaining({
            has_previous: false,
            has_next: false,
            next_cursor: null,
          }),
        );
        expect(res.body.data.map((row: { id: number }) => row.id)).toEqual([5, 4, 3, 2, 1]);
      },
    );
  });

  describe('limit clamping', () => {
    it('clamps limit to MAX_LIMIT (500)', async () => {
      table = Array.from({ length: 505 }, (_, i) => txRow(505 - i, USER_A));

      const res = await request(app)
        .get('/api/transactions/me?limit=10000')
        .set('Authorization', `Bearer ${createAuthToken(USER_A)}`);

      expect(res.status).toBe(200);
      expect(res.body.page_info).toEqual(
        expect.objectContaining({
          limit: 500,
          count: 500,
          has_next: true,
        }),
      );
      expect(res.body.data).toHaveLength(500);
      expect(res.body.data[0].id).toBe(505);
      // Controller probes limit + 1 rows, so the clamp is visible in the query.
      expect(lastParams[1]).toBe(501);
    });

    it('falls back to the default limit for invalid limit values', async () => {
      table = Array.from({ length: 25 }, (_, i) => txRow(25 - i, USER_A));

      for (const limit of ['abc', '0', '-5']) {
        const res = await request(app)
          .get(`/api/transactions/me?limit=${encodeURIComponent(limit)}`)
          .set('Authorization', `Bearer ${createAuthToken(USER_A)}`);

        expect(res.status).toBe(200);
        expect(res.body.page_info.limit).toBe(20);
        expect(lastParams[1]).toBe(21);
      }
    });
  });

  describe('ownership filter', () => {
    it('never returns rows submitted by another user', async () => {
      // USER_B rows have higher ids: if the ownership filter were dropped they
      // would appear first in the newest-first ordering.
      table = [
        ...[99, 98, 97].map((id) => txRow(id, USER_B)),
        ...[30, 29, 28].map((id) => txRow(id, USER_A)),
      ];

      const res = await request(app)
        .get('/api/transactions/me')
        .set('Authorization', `Bearer ${createAuthToken(USER_A)}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(3);
      for (const row of res.body.data) {
        expect(row.submittedBy).toBe(USER_A);
        expect([30, 29, 28]).toContain(row.id);
      }
      expect(res.body.data.map((row: { id: number }) => row.id)).toEqual([30, 29, 28]);

      // The SQL itself must filter on the authenticated wallet as $1.
      expect(lastParams[0]).toBe(USER_A);
      expect(normalizeSql(lastSql)).toContain('WHERE submitted_by = $1');
    });

    it('applies the ownership filter on cursor pages too', async () => {
      table = [
        ...[99, 98, 97].map((id) => txRow(id, USER_B)),
        ...[30, 29, 28].map((id) => txRow(id, USER_A)),
      ];

      const res = await request(app)
        .get('/api/transactions/me?limit=2&cursor=29')
        .set('Authorization', `Bearer ${createAuthToken(USER_A)}`);

      expect(res.status).toBe(200);
      expect(res.body.data.map((row: { id: number }) => row.id)).toEqual([28]);
      expect(lastParams[0]).toBe(USER_A);
      expect(lastParams[2]).toBe(29);
      expect(normalizeSql(lastSql)).toContain('WHERE submitted_by = $1');
      expect(normalizeSql(lastSql)).toContain('AND id < $3');
    });
  });
});
