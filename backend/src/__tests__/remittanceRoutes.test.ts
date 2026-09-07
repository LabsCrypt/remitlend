import request from 'supertest';
import { jest } from '@jest/globals';
import { Keypair } from '@stellar/stellar-sdk';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-jwt-secret-min-32-chars-long!!';

const SENDER = Keypair.random().publicKey();
const OTHER_USER = Keypair.random().publicKey();
const RECIPIENT = Keypair.random().publicKey();

const mockCreateRemittance = jest.fn();
const mockGetRemittance = jest.fn();
const mockUpdateRemittanceStatus = jest.fn();

jest.unstable_mockModule('../services/remittanceService.js', () => ({
  remittanceService: {
    createRemittance: mockCreateRemittance,
    getRemittance: mockGetRemittance,
    updateRemittanceStatus: mockUpdateRemittanceStatus,
  },
}));

const mockSubmitSignedTx = jest.fn();
jest.unstable_mockModule('../services/sorobanService.js', () => ({
  sorobanService: {
    submitSignedTx: mockSubmitSignedTx,
  },
}));

const mockCreateNotification = jest.fn();
jest.unstable_mockModule('../services/notificationService.js', () => ({
  notificationService: {
    createNotification: mockCreateNotification,
  },
}));

jest.unstable_mockModule('../utils/stellarEnvelope.js', () => ({
  parseAndValidateSignedEnvelope: jest.fn().mockReturnValue({
    source: 'GCWEPACYJLN7S3ZUXSVMXZBFKYXSHRGZ6O326HDDPDKBKZPXD45XNHC3',
    signatureCount: 1,
  }),
}));

const mockQuery = jest.fn();
jest.unstable_mockModule('../db/connection.js', () => ({
  default: { query: mockQuery },
  query: mockQuery,
  getClient: jest.fn(),
  closePool: jest.fn(),
  withTransaction: jest.fn(),
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

const createAuthToken = (
  publicKey: string,
  scopes: string[] = ['read:remittances', 'write:remittances'],
) => {
  return jwt.sign({ publicKey, role: 'borrower', scopes }, process.env.JWT_SECRET!, {
    algorithm: 'HS256',
    expiresIn: '1h',
  });
};

describe('Remittance Routes JWT Authentication & Authorization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fakeCacheStore.clear();
  });

  describe('POST /api/remittances', () => {
    const validBody = {
      recipientAddress: RECIPIENT,
      amount: 100,
      fromCurrency: 'USDC',
      toCurrency: 'USDC',
      memo: 'test memo',
    };

    it('returns 401 when Authorization header is missing', async () => {
      const res = await request(app).post('/api/remittances').send(validBody);
      expect(res.status).toBe(401);
      expect(res.body.message).toContain('Missing or invalid Authorization header');
    });

    it('returns 201 with valid JWT token and derives senderAddress from req.user.publicKey', async () => {
      const token = createAuthToken(SENDER);
      const mockRemittance = {
        id: 'remit-123',
        senderId: SENDER,
        recipientAddress: RECIPIENT,
        amount: '100',
        fromCurrency: 'USDC',
        toCurrency: 'USDC',
        status: 'pending',
      };
      (mockCreateRemittance as jest.Mock).mockResolvedValue(mockRemittance);

      const res = await request(app)
        .post('/api/remittances')
        .set('Authorization', `Bearer ${token}`)
        .send(validBody);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(mockRemittance);
      expect(mockCreateRemittance).toHaveBeenCalledWith({
        ...validBody,
        senderAddress: SENDER,
      });
    });
  });

  describe('GET /api/remittances', () => {
    it('returns 401 when Authorization header is missing', async () => {
      const res = await request(app).get('/api/remittances');
      expect(res.status).toBe(401);
    });

    it('returns 200 with valid JWT token and filters by senderAddress from req.user.publicKey', async () => {
      const token = createAuthToken(SENDER);

      // Mock MAX(seq) query
      (mockQuery as jest.Mock).mockResolvedValueOnce({
        rows: [{ max_seq: '10' }],
      });
      // Mock main query
      (mockQuery as jest.Mock).mockResolvedValueOnce({
        rows: [
          {
            id: 'remit-1',
            sender_id: SENDER,
            recipient_address: RECIPIENT,
            amount: '50',
            created_at: new Date().toISOString(),
            seq: 1,
          },
        ],
      });
      // Mock count query
      (mockQuery as jest.Mock).mockResolvedValueOnce({
        rows: [{ count: '1' }],
      });

      const res = await request(app)
        .get('/api/remittances')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      // Verify query params used the authenticated user's public key as $1
      const mainQueryParams = (mockQuery as jest.Mock).mock.calls[1][1];
      expect(mainQueryParams[0]).toBe(SENDER);
    });
  });

  describe('GET /api/remittances/:id', () => {
    it('returns 401 when Authorization header is missing', async () => {
      const res = await request(app).get('/api/remittances/remit-123');
      expect(res.status).toBe(401);
    });

    it('returns 200 when authenticated user owns the remittance', async () => {
      const token = createAuthToken(SENDER);
      const mockRemittance = {
        id: 'remit-123',
        senderId: SENDER,
        recipientAddress: RECIPIENT,
        amount: '100',
      };
      (mockGetRemittance as jest.Mock).mockResolvedValue(mockRemittance);

      const res = await request(app)
        .get('/api/remittances/remit-123')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(mockRemittance);
    });

    it('returns 403 when authenticated user does not own the remittance', async () => {
      const token = createAuthToken(OTHER_USER);
      const mockRemittance = {
        id: 'remit-123',
        senderId: SENDER, // belongs to SENDER, not OTHER_USER
        recipientAddress: RECIPIENT,
        amount: '100',
      };
      (mockGetRemittance as jest.Mock).mockResolvedValue(mockRemittance);

      const res = await request(app)
        .get('/api/remittances/remit-123')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('do not have access');
    });
  });

  describe('POST /api/remittances/:id/submit', () => {
    const validSignedXdr = 'AAAAAgAAAAEAAAA=';

    it('returns 401 when Authorization header is missing', async () => {
      const res = await request(app)
        .post('/api/remittances/remit-123/submit')
        .send({ signedXdr: validSignedXdr });
      expect(res.status).toBe(401);
    });

    it('returns 200 when authenticated user owns the remittance and submits transaction', async () => {
      const token = createAuthToken(SENDER);
      const mockRemittance = {
        id: 'remit-123',
        senderId: SENDER,
        status: 'pending',
        amount: '100',
        fromCurrency: 'USDC',
      };
      (mockGetRemittance as jest.Mock).mockResolvedValue(mockRemittance);
      (mockUpdateRemittanceStatus as jest.Mock).mockResolvedValue({
        id: 'remit-123',
        status: 'completed',
      });
      (mockSubmitSignedTx as jest.Mock).mockResolvedValue({
        txHash: 'txhash-123',
        status: 'SUCCESS',
      });

      const res = await request(app)
        .post('/api/remittances/remit-123/submit')
        .set('Authorization', `Bearer ${token}`)
        .send({ signedXdr: validSignedXdr });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.txHash).toBe('txhash-123');
    });

    it('returns 403 when authenticated user does not own the remittance', async () => {
      const token = createAuthToken(OTHER_USER);
      const mockRemittance = {
        id: 'remit-123',
        senderId: SENDER, // belongs to SENDER, not OTHER_USER
        status: 'pending',
      };
      (mockGetRemittance as jest.Mock).mockResolvedValue(mockRemittance);

      const res = await request(app)
        .post('/api/remittances/remit-123/submit')
        .set('Authorization', `Bearer ${token}`)
        .send({ signedXdr: validSignedXdr });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('do not have access');
    });
  });
});
