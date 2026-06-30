import request from 'supertest';
import { jest } from '@jest/globals';
import { Keypair } from '@stellar/stellar-sdk';
import { generateJwtToken } from '../services/authService.js';

process.env.JWT_SECRET = 'test-jwt-secret-min-32-chars-long!!';

// Setup mocks BEFORE importing the app
const mockQuery = jest.fn<(...args: unknown[]) => Promise<{ rows: unknown[] }>>();
const mockRelease = jest.fn();
const mockClient = {
  query: mockQuery,
  release: mockRelease,
};

jest.unstable_mockModule('../db/connection.js', () => ({
  default: { query: mockQuery },
  query: mockQuery,
  getClient: jest.fn<() => Promise<typeof mockClient>>().mockResolvedValue(mockClient),
  closePool: jest.fn(),
  withTransaction: jest.fn(),
}));

// Mock CacheService to prevent Redis connections
jest.unstable_mockModule('../services/cacheService.js', () => ({
  cacheService: {
    get: jest.fn<() => Promise<null>>().mockResolvedValue(null),
    set: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    delete: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    ping: jest.fn<() => Promise<string>>().mockResolvedValue('ok'),
  },
}));

// Use dynamic imports to ensure mocks are applied
await import('../db/connection.js');
const { default: app } = await import('../app.js');

const TEST_WALLET = Keypair.random().publicKey();
const OTHER_WALLET = Keypair.random().publicKey();
const authHeader = `Bearer ${generateJwtToken(TEST_WALLET)}`;

describe('Input Validation', () => {
  describe('POST /api/simulate', () => {
    it('should return 401 without authentication', async () => {
      const response = await request(app).post('/api/simulate').send({
        amount: 500,
      });

      expect(response.status).toBe(401);
    });

    it('should accept valid input with authentication', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ current_score: 500 }],
      });

      const response = await request(app)
        .post('/api/simulate')
        .set('Authorization', authHeader)
        .send({ amount: 500 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should reject missing amount', async () => {
      const response = await request(app)
        .post('/api/simulate')
        .set('Authorization', authHeader)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should reject negative amount', async () => {
      const response = await request(app)
        .post('/api/simulate')
        .set('Authorization', authHeader)
        .send({ amount: -100 });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.errors).toBeDefined();
    });

    it('should reject amount exceeding maximum', async () => {
      const response = await request(app)
        .post('/api/simulate')
        .set('Authorization', authHeader)
        .send({ amount: 2000000 });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should reject zero amount', async () => {
      const response = await request(app)
        .post('/api/simulate')
        .set('Authorization', authHeader)
        .send({ amount: 0 });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should reject non-numeric amount', async () => {
      const response = await request(app)
        .post('/api/simulate')
        .set('Authorization', authHeader)
        .send({ amount: 'five hundred' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/history/:userId', () => {
    it('should return 401 without authentication', async () => {
      const response = await request(app).get(`/api/history/${TEST_WALLET}`);

      expect(response.status).toBe(401);
    });

    it('should return 403 when wallet does not match JWT', async () => {
      const response = await request(app)
        .get(`/api/history/${OTHER_WALLET}`)
        .set('Authorization', authHeader);

      expect(response.status).toBe(403);
    });

    it('should accept matching wallet with authentication', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ current_score: 500 }] })
        .mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .get(`/api/history/${TEST_WALLET}`)
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body.userId).toBe(TEST_WALLET);
    });

    it('should return 404 for empty userId segment', async () => {
      const response = await request(app).get('/api/history/');

      expect(response.status).toBe(404);
    });
  });
});
