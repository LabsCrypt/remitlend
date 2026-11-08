import request from 'supertest';
import { jest, describe, it, expect, beforeEach, afterAll } from '@jest/globals';

type MockQueryResult = { rows: Record<string, unknown>[]; rowCount?: number };

process.env.JWT_SECRET = 'test-jwt-secret-min-32-chars-long!!';
const LENDER_USER_ID = 'GLENDERWALLET1111111111111111111111111111111111111111111';
process.env.LENDER_WALLETS = LENDER_USER_ID;

const mockQuery: jest.MockedFunction<
  (text: string, params?: unknown[]) => Promise<MockQueryResult>
> = jest.fn();

const fakeCacheStore = new Map<string, unknown>();

await jest.unstable_mockModule('../db/connection.js', () => ({
  default: { query: mockQuery },
  query: mockQuery,
  getClient: jest.fn(),
  closePool: jest.fn(),
  withTransaction: jest.fn(),
}));

await jest.unstable_mockModule('../services/cacheService.js', () => ({
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

await import('../db/connection.js');
const { default: app } = await import('../app.js');
const { generateJwtToken } = await import('../services/authService.js');

const ALICE_USER_ID = 'GALICEUSER11111111111111111111111111111111111111111111111';
const BOB_USER_ID = 'GBOBUSER222222222222222222222222222222222222222222222222';

const bearer = (publicKey: string) => ({
  Authorization: `Bearer ${generateJwtToken(publicKey)}`,
});

function createMockNotification(id: number, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    user_id: ALICE_USER_ID,
    type: 'loan_approved',
    title: `Notification ${id}`,
    message: `Message for notification ${id}`,
    loan_id: 100 + id,
    action_url: `/loans/${100 + id}`,
    read: false,
    status: 'unread',
    created_at: new Date(Date.now() - id * 60000),
    ...overrides,
  };
}

describe('Notification Route Pagination & Listing Contracts (#2099)', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    fakeCacheStore.clear();
    jest.clearAllMocks();
  });

  afterAll(() => {
    delete process.env.JWT_SECRET;
    delete process.env.LENDER_WALLETS;
  });

  describe('Stable Pagination & Limit Boundaries', () => {
    it('applies default limit of 50 when limit parameter is omitted', async () => {
      const mockRows = Array.from({ length: 5 }, (_, i) => createMockNotification(i + 1));
      mockQuery.mockResolvedValueOnce({ rows: mockRows, rowCount: 5 });
      mockQuery.mockResolvedValueOnce({ rows: [{ count: '5' }], rowCount: 1 });

      const res = await request(app).get('/api/notifications').set(bearer(ALICE_USER_ID));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.notifications).toHaveLength(5);
      expect(res.body.data.unreadCount).toBe(5);

      // Verify SQL contains ORDER BY created_at DESC and LIMIT with default 50
      const queryCall = mockQuery.mock.calls[0];
      const sql = queryCall[0] as string;
      const params = queryCall[1] as unknown[];
      expect(sql).toContain('ORDER BY created_at DESC');
      expect(sql).toContain('LIMIT $2');
      expect(params).toEqual([ALICE_USER_ID, 50]);
    });

    it('respects minimum allowed boundary limit=1', async () => {
      const mockRow = createMockNotification(1);
      mockQuery.mockResolvedValueOnce({ rows: [mockRow], rowCount: 1 });
      mockQuery.mockResolvedValueOnce({ rows: [{ count: '10' }], rowCount: 1 });

      const res = await request(app).get('/api/notifications?limit=1').set(bearer(ALICE_USER_ID));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.notifications).toHaveLength(1);
      expect(res.body.data.unreadCount).toBe(10);

      const params = mockQuery.mock.calls[0][1] as unknown[];
      expect(params).toEqual([ALICE_USER_ID, 1]);
    });

    it('respects maximum allowed boundary limit=100', async () => {
      const mockRows = Array.from({ length: 20 }, (_, i) => createMockNotification(i + 1));
      mockQuery.mockResolvedValueOnce({ rows: mockRows, rowCount: 20 });
      mockQuery.mockResolvedValueOnce({ rows: [{ count: '20' }], rowCount: 1 });

      const res = await request(app).get('/api/notifications?limit=100').set(bearer(ALICE_USER_ID));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.notifications).toHaveLength(20);

      const params = mockQuery.mock.calls[0][1] as unknown[];
      expect(params).toEqual([ALICE_USER_ID, 100]);
    });

    it('returns empty array and 0 unreadCount when user has zero notifications', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }], rowCount: 1 });

      const res = await request(app).get('/api/notifications').set(bearer(ALICE_USER_ID));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.notifications).toEqual([]);
      expect(res.body.data.unreadCount).toBe(0);
    });

    it('maintains strict newest-first chronological ordering from database response', async () => {
      const dateNew = new Date('2026-11-08T11:00:00Z');
      const dateMid = new Date('2026-11-08T10:00:00Z');
      const dateOld = new Date('2026-11-08T09:00:00Z');

      const mockRows = [
        createMockNotification(3, { created_at: dateNew }),
        createMockNotification(2, { created_at: dateMid }),
        createMockNotification(1, { created_at: dateOld }),
      ];
      mockQuery.mockResolvedValueOnce({ rows: mockRows, rowCount: 3 });
      mockQuery.mockResolvedValueOnce({ rows: [{ count: '3' }], rowCount: 1 });

      const res = await request(app).get('/api/notifications').set(bearer(ALICE_USER_ID));

      expect(res.status).toBe(200);
      const items = res.body.data.notifications;
      expect(items).toHaveLength(3);
      expect(new Date(items[0].createdAt).getTime()).toBeGreaterThan(
        new Date(items[1].createdAt).getTime(),
      );
      expect(new Date(items[1].createdAt).getTime()).toBeGreaterThan(
        new Date(items[2].createdAt).getTime(),
      );
    });

    it('rejects limit=0 with 400 Bad Request error contract', async () => {
      const res = await request(app).get('/api/notifications?limit=0').set(bearer(ALICE_USER_ID));

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBeDefined();
    });

    it('rejects negative limit with 400 Bad Request', async () => {
      const res = await request(app).get('/api/notifications?limit=-10').set(bearer(ALICE_USER_ID));

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('rejects limit exceeding maximum (limit=101) with 400 Bad Request', async () => {
      const res = await request(app).get('/api/notifications?limit=101').set(bearer(ALICE_USER_ID));

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('rejects non-numeric limit strings with 400 Bad Request', async () => {
      const res = await request(app)
        .get('/api/notifications?limit=five')
        .set(bearer(ALICE_USER_ID));

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('Read & Status Filtering Semantics', () => {
    it('filters by status=unread and returns unread notifications with read=false', async () => {
      const unreadRow = createMockNotification(1, { read: false, status: 'unread' });
      mockQuery.mockResolvedValueOnce({ rows: [unreadRow], rowCount: 1 });
      mockQuery.mockResolvedValueOnce({ rows: [{ count: '1' }], rowCount: 1 });

      const res = await request(app)
        .get('/api/notifications?status=unread')
        .set(bearer(ALICE_USER_ID));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.notifications).toHaveLength(1);
      expect(res.body.data.notifications[0].status).toBe('unread');
      expect(res.body.data.notifications[0].read).toBe(false);

      const queryCall = mockQuery.mock.calls[0];
      const sql = queryCall[0] as string;
      const params = queryCall[1] as unknown[];
      expect(sql).toContain('AND status = $2');
      expect(params).toEqual([ALICE_USER_ID, 'unread', 50]);
    });

    it('filters by status=read and preserves accurate unreadCount across total inbox', async () => {
      const readRow = createMockNotification(2, { read: true, status: 'read' });
      mockQuery.mockResolvedValueOnce({ rows: [readRow], rowCount: 1 });
      // Total unread count in inbox is 4, even though we filtered for status=read
      mockQuery.mockResolvedValueOnce({ rows: [{ count: '4' }], rowCount: 1 });

      const res = await request(app)
        .get('/api/notifications?status=read')
        .set(bearer(ALICE_USER_ID));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.notifications).toHaveLength(1);
      expect(res.body.data.notifications[0].status).toBe('read');
      expect(res.body.data.notifications[0].read).toBe(true);
      expect(res.body.data.unreadCount).toBe(4);
    });

    it('filters by status=archived correctly', async () => {
      const archivedRow = createMockNotification(3, { read: true, status: 'archived' });
      mockQuery.mockResolvedValueOnce({ rows: [archivedRow], rowCount: 1 });
      mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }], rowCount: 1 });

      const res = await request(app)
        .get('/api/notifications?status=archived')
        .set(bearer(ALICE_USER_ID));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.notifications[0].status).toBe('archived');
      expect(res.body.data.notifications[0].read).toBe(true);
    });

    it('rejects unsupported status values with 400 Bad Request', async () => {
      const res = await request(app)
        .get('/api/notifications?status=deleted')
        .set(bearer(ALICE_USER_ID));

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('Deleted & Purged Records Behavior', () => {
    it('excludes records purged by retention cleanup from active listing', async () => {
      // Simulates DB query where purged/deleted records no longer match WHERE user_id = $1
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }], rowCount: 1 });

      const res = await request(app).get('/api/notifications').set(bearer(ALICE_USER_ID));

      expect(res.status).toBe(200);
      expect(res.body.data.notifications).toHaveLength(0);
      expect(res.body.data.unreadCount).toBe(0);
    });

    it('markRead endpoint handles already-deleted or non-existent IDs gracefully', async () => {
      // Database UPDATE affects 0 rows because the notification IDs were already deleted
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const res = await request(app)
        .post('/api/notifications/mark-read')
        .set(bearer(ALICE_USER_ID))
        .send({ ids: [99999, 88888] });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const updateCall = mockQuery.mock.calls[0];
      const sql = updateCall[0] as string;
      const params = updateCall[1] as unknown[];
      expect(sql).toContain("UPDATE notifications SET read = true, status = 'read'");
      expect(params).toEqual([ALICE_USER_ID, [99999, 88888]]);
    });

    it('markRead endpoint succeeds immediately when ids array is empty', async () => {
      const res = await request(app)
        .post('/api/notifications/mark-read')
        .set(bearer(ALICE_USER_ID))
        .send({ ids: [] });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('markRead rejects payload with more than 100 IDs with 400 Bad Request', async () => {
      const tooManyIds = Array.from({ length: 101 }, (_, i) => i + 1);

      const res = await request(app)
        .post('/api/notifications/mark-read')
        .set(bearer(ALICE_USER_ID))
        .send({ ids: tooManyIds });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message ?? res.body.error?.message).toContain(
        'Cannot mark more than 100 notifications at once',
      );
    });

    it('markRead rejects non-numeric or malformed IDs with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/notifications/mark-read')
        .set(bearer(ALICE_USER_ID))
        .send({ ids: ['invalid-id', 123] });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('Authorization & Multi-Tenant Isolation', () => {
    it('rejects unauthenticated request with 401 Unauthorized', async () => {
      const res = await request(app).get('/api/notifications');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('rejects caller lacking read:notifications scope (e.g. lender role) with 403 Forbidden', async () => {
      const res = await request(app).get('/api/notifications').set(bearer(LENDER_USER_ID));

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('strictly isolates user records ensuring Alice queries only her own notifications', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [createMockNotification(1)], rowCount: 1 });
      mockQuery.mockResolvedValueOnce({ rows: [{ count: '1' }], rowCount: 1 });

      await request(app).get('/api/notifications').set(bearer(ALICE_USER_ID));

      const listSql = mockQuery.mock.calls[0][0] as string;
      const listParams = mockQuery.mock.calls[0][1] as unknown[];
      const countSql = mockQuery.mock.calls[1][0] as string;
      const countParams = mockQuery.mock.calls[1][1] as unknown[];

      expect(listSql).toContain('user_id = $1');
      expect(listParams[0]).toBe(ALICE_USER_ID);
      expect(listParams[0]).not.toBe(BOB_USER_ID);

      expect(countSql).toContain("WHERE user_id = $1 AND status = 'unread'");
      expect(countParams[0]).toBe(ALICE_USER_ID);
    });

    it('markAllRead scopes update strictly to authenticated caller publicKey', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 3 });

      const res = await request(app)
        .post('/api/notifications/mark-all-read')
        .set(bearer(ALICE_USER_ID));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const updateCall = mockQuery.mock.calls[0];
      const sql = updateCall[0] as string;
      const params = updateCall[1] as unknown[];
      expect(sql).toContain("UPDATE notifications SET read = true, status = 'read'");
      expect(sql).toContain("WHERE user_id = $1 AND status = 'unread'");
      expect(params).toEqual([ALICE_USER_ID]);
    });
  });
});
