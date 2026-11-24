import request from 'supertest';
import { jest } from '@jest/globals';

type MockQueryResult = { rows: unknown[]; rowCount?: number };

process.env.JWT_SECRET = 'test-jwt-secret-min-32-chars-long!!';

const mockQuery: jest.MockedFunction<
  (text: string, params?: unknown[]) => Promise<MockQueryResult>
> = jest.fn();

const fakeCacheStore = new Map<string, unknown>();
await jest.unstable_mockModule('../db/connection.js', () => ({
  withAdvisoryLock: async (_key: string, fn: () => Promise<unknown>) => fn(),
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
const { default: jwt } = await import('jsonwebtoken');

const userId = 'GTESTUSER1111111111111111111111111111111111111111111111111';

const bearer = (publicKey: string) => ({
  Authorization: `Bearer ${generateJwtToken(publicKey)}`,
});

beforeEach(() => {
  mockQuery.mockReset();
  jest.clearAllMocks();
});

afterAll(() => {
  delete process.env.JWT_SECRET;
});

describe('notification filters', () => {
  it('filters notifications by type', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 1,
          user_id: userId,
          type: 'repayment_due',
          title: 'Repayment Due',
          message: 'Your repayment is due',
          loan_id: 1,
          read: false,
          status: 'unread',
          created_at: new Date('2024-03-15'),
        },
      ],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ count: '1' }],
    });

    const response = await request(app)
      .get('/api/notifications?type=repayment_due')
      .set(bearer(userId));

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.notifications).toHaveLength(1);
    expect(response.body.data.notifications[0].type).toBe('repayment_due');
  });

  it('filters notifications by status', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 2,
          user_id: userId,
          type: 'loan_approved',
          title: 'Loan Approved',
          message: 'Your loan has been approved',
          loan_id: 2,
          read: true,
          status: 'read',
          created_at: new Date('2024-03-10'),
        },
      ],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ count: '1' }],
    });

    const response = await request(app).get('/api/notifications?status=read').set(bearer(userId));

    expect(response.status).toBe(200);
    expect(response.body.data.notifications).toHaveLength(1);
    expect(response.body.data.notifications[0].status).toBe('read');
  });

  it('filters notifications by date range', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 3,
          user_id: userId,
          type: 'score_changed',
          title: 'Score Changed',
          message: 'Your score has changed',
          loan_id: null,
          read: false,
          status: 'unread',
          created_at: new Date('2024-03-20'),
        },
      ],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ count: '1' }],
    });

    const response = await request(app)
      .get('/api/notifications?from=2024-03-01&to=2024-03-31')
      .set(bearer(userId));

    expect(response.status).toBe(200);
    expect(response.body.data.notifications).toHaveLength(1);
  });

  it('combines multiple filters', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 4,
          user_id: userId,
          type: 'repayment_confirmed',
          title: 'Repayment Confirmed',
          message: 'Your repayment has been confirmed',
          loan_id: 3,
          read: true,
          status: 'read',
          created_at: new Date('2024-03-25'),
        },
      ],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ count: '1' }],
    });

    const response = await request(app)
      .get('/api/notifications?type=repayment_confirmed&status=read&from=2024-03-01&to=2024-03-31')
      .set(bearer(userId));

    expect(response.status).toBe(200);
    expect(response.body.data.notifications).toHaveLength(1);
    expect(response.body.data.notifications[0].type).toBe('repayment_confirmed');
    expect(response.body.data.notifications[0].status).toBe('read');
  });

  it('rejects invalid date formats', async () => {
    const response = await request(app)
      .get('/api/notifications?from=invalid-date')
      .set(bearer(userId));

    expect(response.status).toBe(400);
  });

  it('respects limit parameter', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: Array.from({ length: 10 }, (_, i) => ({
        id: i + 1,
        user_id: userId,
        type: 'loan_approved',
        title: 'Loan Approved',
        message: 'Your loan has been approved',
        loan_id: i + 1,
        read: false,
        status: 'unread',
        created_at: new Date('2024-03-15'),
      })),
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ count: '10' }],
    });

    const response = await request(app).get('/api/notifications?limit=10').set(bearer(userId));

    expect(response.status).toBe(200);
    expect(response.body.data.notifications).toHaveLength(10);
  });

  it('rejects invalid status', async () => {
    const response = await request(app)
      .get('/api/notifications?status=invalid_status')
      .set(bearer(userId));

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it('rejects invalid type', async () => {
    const response = await request(app)
      .get('/api/notifications?type=invalid_type')
      .set(bearer(userId));

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it('rejects non-numeric limit', async () => {
    const response = await request(app).get('/api/notifications?limit=abc').set(bearer(userId));

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it('rejects out-of-bounds limit', async () => {
    const response = await request(app).get('/api/notifications?limit=0').set(bearer(userId));

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);

    const responseTooLarge = await request(app)
      .get('/api/notifications?limit=101')
      .set(bearer(userId));

    expect(responseTooLarge.status).toBe(400);
    expect(responseTooLarge.body.success).toBe(false);
  });

  describe('stable pagination, status filters, and deleted records', () => {
    it('uses default limit of 50 and orders by created_at DESC when limit is omitted', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] });

      const response = await request(app).get('/api/notifications').set(bearer(userId));

      expect(response.status).toBe(200);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY created_at DESC'),
        expect.arrayContaining([userId, 50]),
      );
    });

    it('supports pagination boundary limit=1 and limit=100 with SQL parameters', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] });

      const resMin = await request(app).get('/api/notifications?limit=1').set(bearer(userId));

      expect(resMin.status).toBe(200);
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('ORDER BY created_at DESC'), [
        userId,
        1,
      ]);

      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] });

      const resMax = await request(app).get('/api/notifications?limit=100').set(bearer(userId));

      expect(resMax.status).toBe(200);
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('ORDER BY created_at DESC'), [
        userId,
        100,
      ]);
    });

    it('filters notifications by status=unread and returns unread count', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 11,
            user_id: userId,
            type: 'loan_approved',
            title: 'Loan Approved',
            message: 'Your loan was approved',
            loan_id: 5,
            action_url: '/loans/5',
            read: false,
            status: 'unread',
            created_at: new Date('2024-04-01'),
          },
        ],
      });
      mockQuery.mockResolvedValueOnce({
        rows: [{ count: '1' }],
      });

      const response = await request(app)
        .get('/api/notifications?status=unread')
        .set(bearer(userId));

      expect(response.status).toBe(200);
      expect(response.body.data.notifications).toHaveLength(1);
      expect(response.body.data.notifications[0].status).toBe('unread');
      expect(response.body.data.notifications[0].actionUrl).toBe('/loans/5');
      expect(response.body.data.unreadCount).toBe(1);
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('status = $2'), [
        userId,
        'unread',
        50,
      ]);
    });

    it('filters notifications by status=archived and handles custom action URLs', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 12,
            user_id: userId,
            type: 'repayment_due',
            title: 'Repayment Due',
            message: 'Repayment deadline approaching',
            loan_id: null,
            action_url: '/custom/repay',
            read: true,
            status: 'archived',
            created_at: new Date('2024-03-01'),
          },
        ],
      });
      mockQuery.mockResolvedValueOnce({
        rows: [{ count: '0' }],
      });

      const response = await request(app)
        .get('/api/notifications?status=archived')
        .set(bearer(userId));

      expect(response.status).toBe(200);
      expect(response.body.data.notifications).toHaveLength(1);
      expect(response.body.data.notifications[0].status).toBe('archived');
      expect(response.body.data.notifications[0].actionUrl).toBe('/custom/repay');
      expect(response.body.data.unreadCount).toBe(0);
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('status = $2'), [
        userId,
        'archived',
        50,
      ]);
    });

    it('handles empty notification lists when records are deleted or absent', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] });

      const response = await request(app).get('/api/notifications').set(bearer(userId));

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.notifications).toEqual([]);
      expect(response.body.data.unreadCount).toBe(0);
    });

    it('rejects requests missing authentication credentials with 401', async () => {
      const response = await request(app).get('/api/notifications');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    it('rejects requests whose token lacks the read:notifications scope with 403', async () => {
      const tokenWithoutScope = jwt.sign(
        {
          publicKey: userId,
          role: 'user',
          scopes: ['read:profile'],
          jti: 'test-jti-no-scope',
        },
        process.env.JWT_SECRET as string,
      );

      const response = await request(app)
        .get('/api/notifications')
        .set({ Authorization: `Bearer ${tokenWithoutScope}` });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    });
  });
});
