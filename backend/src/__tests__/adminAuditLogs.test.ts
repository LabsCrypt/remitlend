import { jest, describe, it, expect, beforeAll } from '@jest/globals';
import request from 'supertest';

type MockQueryResult = { rows: unknown[]; rowCount?: number };
const mockQuery: jest.MockedFunction<
  (text: string, params?: unknown[]) => Promise<MockQueryResult>
> = jest.fn(async () => ({ rows: [], rowCount: 0 }));
const mockRelease = jest.fn();
const mockClient = { query: mockQuery, release: mockRelease };

jest.unstable_mockModule('../db/connection.js', () => ({
  default: { query: mockQuery },
  pool: { query: mockQuery },
  query: mockQuery,
  getClient: jest.fn<() => Promise<typeof mockClient>>().mockResolvedValue(mockClient),
  closePool: jest.fn(),
  withTransaction: jest.fn(),
}));

jest.unstable_mockModule('../services/cacheService.js', () => ({
  cacheService: {
    get: jest.fn<() => Promise<null>>().mockResolvedValue(null),
    set: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    delete: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    ping: jest.fn<() => Promise<string>>().mockResolvedValue('ok'),
    invalidatePattern: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  },
}));

const { default: app } = await import('../app.js');
const { generateJwtToken } = await import('../services/authService.js');

describe('GET /admin/audit-logs input validation (#1857)', () => {
  const ADMIN_KEY = 'GADMINAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const BORROWER_KEY = 'GBORROWERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

  let adminToken: string;
  let borrowerToken: string;

  beforeAll(() => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
    process.env.ADMIN_WALLETS = ADMIN_KEY;

    adminToken = generateJwtToken(ADMIN_KEY);
    borrowerToken = generateJwtToken(BORROWER_KEY);
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app).get('/api/admin/audit-logs');
    expect(res.status).toBe(401);
  });

  it('rejects non-admin caller with 403', async () => {
    const res = await request(app)
      .get('/api/admin/audit-logs')
      .set('Authorization', `Bearer ${borrowerToken}`);
    expect(res.status).toBe(403);
  });

  it('returns 400 when from=not-a-date and limit=abc (acceptance criteria)', async () => {
    const res = await request(app)
      .get('/api/admin/audit-logs?from=not-a-date&limit=abc')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 when from is not a valid ISO date', async () => {
    const res = await request(app)
      .get('/api/admin/audit-logs?from=invalid-date')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 when to is not a valid ISO date', async () => {
    const res = await request(app)
      .get('/api/admin/audit-logs?to=yesterday')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 when limit is not a positive integer', async () => {
    const resNegative = await request(app)
      .get('/api/admin/audit-logs?limit=-1')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(resNegative.status).toBe(400);

    const resZero = await request(app)
      .get('/api/admin/audit-logs?limit=0')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(resZero.status).toBe(400);

    const resFloat = await request(app)
      .get('/api/admin/audit-logs?limit=12.5')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(resFloat.status).toBe(400);
  });

  it('returns 400 when withTotal is not true or false', async () => {
    const res = await request(app)
      .get('/api/admin/audit-logs?withTotal=maybe')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('accepts valid query parameters and returns 200 with clamped limit', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
    });

    const res = await request(app)
      .get(
        '/api/admin/audit-logs?from=2026-01-01T00:00:00.000Z&to=2026-01-02T00:00:00.000Z&limit=150&withTotal=true',
      )
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
  });
});
