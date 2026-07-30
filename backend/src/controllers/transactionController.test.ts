import { jest } from '@jest/globals';
import request from 'supertest';

const mockQuery =
  jest.fn<(sql: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number }>>();

jest.unstable_mockModule('../db/connection.js', () => ({
  default: {
    query: mockQuery,
    getClient: jest.fn(),
    closePool: jest.fn(),
    withTransaction: jest.fn(),
  },
  query: mockQuery,
  getClient: jest.fn(),
  closePool: jest.fn(),
  withTransaction: jest.fn(),
  pool: {},
}));

// Import app and MAX_LIMIT dynamically to ensure mocks are applied first
const { default: app } = await import('../app.js');
const { MAX_LIMIT } = await import('./transactionController.js');

describe('GET /api/transactions - Pagination Limits', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('should cap page size to MAX_LIMIT when a larger limit is requested', async () => {
    mockQuery.mockImplementation(async (sql, params) => {
      if (sql.includes('COUNT(*)')) {
        return { rows: [{ count: '150' }], rowCount: 1 };
      }
      const limit = params ? params[0] : 100;
      const rows = Array.from({ length: limit }, (_, i) => ({ id: i + 1 }));
      return { rows, rowCount: rows.length };
    });

    const res = await request(app).get('/api/transactions').query({ limit: 5000 }).expect(200);

    expect(res.body.pagination.limit).toBe(MAX_LIMIT); // Expect 100
    expect(res.body.data.length).toBeLessThanOrEqual(MAX_LIMIT);
  });

  it('should use requested limit if under MAX_LIMIT', async () => {
    mockQuery.mockImplementation(async (sql, params) => {
      if (sql.includes('COUNT(*)')) {
        return { rows: [{ count: '150' }], rowCount: 1 };
      }
      const limit = params ? params[0] : 50;
      const rows = Array.from({ length: limit }, (_, i) => ({ id: i + 1 }));
      return { rows, rowCount: rows.length };
    });

    const res = await request(app).get('/api/transactions').query({ limit: 50 }).expect(200);

    expect(res.body.pagination.limit).toBe(50);
  });
});
