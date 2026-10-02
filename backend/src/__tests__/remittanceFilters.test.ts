/**
 * Regression tests for the GET /api/remittances list filters (#1881).
 *
 * `from`/`to`/`q` have been supported since #948, but the remittances page
 * never passed them, so the filter inputs did nothing. `minAmount`/`maxAmount`
 * did not exist on the API at all and are added here.
 *
 * These assert the SQL and bind parameters rather than the response body,
 * because the query is mocked — that is the only place the filters are
 * actually observable.
 */

import request from 'supertest';
import { jest } from '@jest/globals';
import { Keypair } from '@stellar/stellar-sdk';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-jwt-secret-min-32-chars-long!!';

const SENDER = Keypair.random().publicKey();
const RECIPIENT = Keypair.random().publicKey();

jest.unstable_mockModule('../services/remittanceService.js', () => ({
  remittanceService: {
    createRemittance: jest.fn(),
    getRemittance: jest.fn(),
    updateRemittanceStatus: jest.fn(),
  },
}));

jest.unstable_mockModule('../services/sorobanService.js', () => ({
  sorobanService: { submitSignedTx: jest.fn() },
}));

jest.unstable_mockModule('../services/notificationService.js', () => ({
  notificationService: { createNotification: jest.fn() },
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

const createAuthToken = (publicKey: string) =>
  jwt.sign({ publicKey, role: 'borrower', scopes: ['read:remittances'] }, process.env.JWT_SECRET!, {
    algorithm: 'HS256',
    expiresIn: '1h',
  });

/** Queues the three queries the list endpoint issues: max(seq), page, count. */
function primeQueries(rows: Record<string, unknown>[] = []) {
  (mockQuery as jest.Mock).mockResolvedValueOnce({ rows: [{ max_seq: '10' }] });
  (mockQuery as jest.Mock).mockResolvedValueOnce({ rows });
  (mockQuery as jest.Mock).mockResolvedValueOnce({ rows: [{ count: String(rows.length) }] });
}

function mainQuery() {
  const [text, params] = (mockQuery as jest.Mock).mock.calls[1];
  return { text: text as string, params: params as unknown[] };
}

describe('GET /api/remittances filters (#1881)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fakeCacheStore.clear();
  });

  it('applies minAmount and maxAmount as bound parameters', async () => {
    primeQueries();
    const res = await request(app)
      .get('/api/remittances?minAmount=10&maxAmount=500')
      .set('Authorization', `Bearer ${createAuthToken(SENDER)}`);

    expect(res.status).toBe(200);
    const { text, params } = mainQuery();
    expect(text).toContain('amount >=');
    expect(text).toContain('amount <=');
    // Values are bound, never interpolated.
    expect(params).toContain('10');
    expect(params).toContain('500');
    expect(text).not.toContain('500)');
  });

  it('applies only minAmount when maxAmount is absent', async () => {
    primeQueries();
    await request(app)
      .get('/api/remittances?minAmount=25')
      .set('Authorization', `Bearer ${createAuthToken(SENDER)}`);

    const { text } = mainQuery();
    expect(text).toContain('amount >=');
    expect(text).not.toContain('amount <=');
  });

  it('applies only maxAmount when minAmount is absent', async () => {
    primeQueries();
    await request(app)
      .get('/api/remittances?maxAmount=25')
      .set('Authorization', `Bearer ${createAuthToken(SENDER)}`);

    const { text } = mainQuery();
    expect(text).not.toContain('amount >=');
    expect(text).toContain('amount <=');
  });

  it('adds no amount clause when neither bound is given', async () => {
    primeQueries();
    await request(app)
      .get('/api/remittances')
      .set('Authorization', `Bearer ${createAuthToken(SENDER)}`);

    const { text } = mainQuery();
    expect(text).not.toContain('amount >=');
    expect(text).not.toContain('amount <=');
  });

  it('honours an explicit zero bound rather than discarding it', async () => {
    // Guards a truthiness bug: a `0` bound is meaningful, so it must not be
    // skipped by an `if (minAmount)` check.
    primeQueries();
    await request(app)
      .get('/api/remittances?minAmount=0')
      .set('Authorization', `Bearer ${createAuthToken(SENDER)}`);

    expect(mainQuery().text).toContain('amount >=');
  });

  it('rejects a non-numeric amount bound with a 400', async () => {
    const res = await request(app)
      .get('/api/remittances?minAmount=abc')
      .set('Authorization', `Bearer ${createAuthToken(SENDER)}`);

    // Failing loudly beats silently dropping the filter and returning
    // unfiltered rows the user believes are filtered.
    expect(res.status).toBe(400);
    // And it must not have reached the database.
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('still applies the sender constraint alongside the amount filters', async () => {
    primeQueries();
    await request(app)
      .get('/api/remittances?minAmount=10&maxAmount=500')
      .set('Authorization', `Bearer ${createAuthToken(SENDER)}`);

    const { text, params } = mainQuery();
    expect(text).toContain('sender_id = $1');
    expect(params[0]).toBe(SENDER);
  });

  it('continues to apply search and date filters', async () => {
    primeQueries();
    await request(app)
      .get('/api/remittances?q=alice&from=2026-01-01T00:00:00.000Z&to=2026-01-31T23:59:59.999Z')
      .set('Authorization', `Bearer ${createAuthToken(SENDER)}`);

    const { text } = mainQuery();
    expect(text).toContain('ILIKE');
    expect(text).toContain('created_at >=');
    expect(text).toContain('created_at <=');
  });

  it('returns matching rows', async () => {
    primeQueries([
      {
        id: 'remit-1',
        sender_id: SENDER,
        recipient_address: RECIPIENT,
        amount: '50',
        status: 'completed',
        created_at: new Date().toISOString(),
        seq: 1,
      },
    ]);
    const res = await request(app)
      .get('/api/remittances?minAmount=10&maxAmount=500')
      .set('Authorization', `Bearer ${createAuthToken(SENDER)}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    // numeric columns come back from pg as strings
    expect(Number(res.body.data[0].amount)).toBe(50);
  });
});
