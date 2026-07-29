import request from 'supertest';
import app from '../../app';
import { MAX_LIMIT } from '../../controllers/transactionController';

describe('GET /api/transactions - Pagination Limits', () => {
  it('should cap page size to MAX_LIMIT when a larger limit is requested', async () => {
    const res = await request(app)
      .get('/api/transactions')
      .query({ limit: 5000 })
      .expect(200);

    expect(res.body.pagination.limit).toBe(MAX_LIMIT); // Expect 100
    expect(res.body.data.length).toBeLessThanOrEqual(MAX_LIMIT);
  });

  it('should use requested limit if under MAX_LIMIT', async () => {
    const res = await request(app)
      .get('/api/transactions')
      .query({ limit: 50 })
      .expect(200);

    expect(res.body.pagination.limit).toBe(50);
  });
});