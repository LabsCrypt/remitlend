import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import request from 'supertest';

process.env.JWT_SECRET = 'user-profile-test-secret';
process.env.PII_KEK_KEY = '0'.repeat(64);
process.env.PII_KEK_ID = 'test-kek';

const queryMock = jest.fn<
  () => Promise<{
    rows: unknown[];
    rowCount: number;
    command: string;
    oid: number;
    fields: unknown[];
  }>
>();

const poolQueryMock = jest.fn<
  () => Promise<{
    rows: unknown[];
    rowCount: number;
    command: string;
    oid: number;
    fields: unknown[];
  }>
>();

jest.unstable_mockModule('../db/connection.js', () => ({
  withAdvisoryLock: async (_key: string, fn: () => Promise<unknown>) => fn(),
  default: {
    query: queryMock,
  },
  query: queryMock,
  pool: {
    query: poolQueryMock,
  },
  getClient: jest.fn(),
  withTransaction: jest.fn(),
}));

jest.unstable_mockModule('../services/cacheService.js', () => ({
  cacheService: {
    ping: jest.fn<() => Promise<string>>().mockResolvedValue('ok'),
  },
}));

jest.unstable_mockModule('../services/sorobanService.js', () => ({
  sorobanService: {
    ping: jest.fn<() => Promise<string>>().mockResolvedValue('ok'),
    getScoreConfig: jest.fn(() => ({
      repaymentDelta: 20,
      defaultPenalty: 50,
    })),
  },
}));

const { default: app } = await import('../app.js');

const publicKey = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

function bearerToken() {
  return jwt.sign(
    {
      publicKey,
      role: 'borrower',
      scopes: ['read:profile', 'write:profile'],
    },
    process.env.JWT_SECRET!,
    { expiresIn: '1h', algorithm: 'HS256' },
  );
}

function profileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 12,
    public_key: publicKey,
    display_name: null,
    email: null,
    phone: null,
    email_enabled: false,
    sms_enabled: false,
    metadata: {},
    created_at: '2026-05-27T00:00:00.000Z',
    updated_at: '2026-05-27T00:00:00.000Z',
    ...overrides,
  };
}

describe('/user/profile', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it("returns the authenticated user's profile and creates an empty row on first call", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [profileRow()],
      rowCount: 1,
      command: 'SELECT',
      oid: 0,
      fields: [],
    });

    const response = await request(app)
      .get('/user/profile')
      .set('Authorization', `Bearer ${bearerToken()}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: '12',
      email: '',
      walletAddress: publicKey,
      kycVerified: false,
      displayName: '',
      phone: '',
    });
    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO user_profiles'), [
      publicKey,
    ]);
  });

  it('updates allowed profile fields after validation', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [profileRow({ metadata: { kycVerified: true } })],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      })
      .mockResolvedValueOnce({
        rows: [
          profileRow({
            display_name: 'Ada Lovelace',
            email: 'ada@example.com',
            phone: '+15551234567',
            metadata: {
              kycVerified: true,
              locale: 'en-US',
              avatarUrl: 'https://example.com/avatar.png',
            },
          }),
        ],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

    const response = await request(app)
      .patch('/user/profile')
      .set('Authorization', `Bearer ${bearerToken()}`)
      .send({
        displayName: 'Ada Lovelace',
        email: 'ada@example.com',
        phone: '+15551234567',
        locale: 'en-US',
        avatarUrl: 'https://example.com/avatar.png',
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      email: 'ada@example.com',
      walletAddress: publicKey,
      kycVerified: true,
      displayName: 'Ada Lovelace',
      phone: '+15551234567',
      locale: 'en-US',
      avatarUrl: 'https://example.com/avatar.png',
    });

    // The e-mail address and the phone number must never be persisted in
    // cleartext: they are stored as an envelope encrypted ciphertext and the
    // legacy plaintext columns are cleared (#1828).
    const [sql, params] = queryMock.mock.calls.at(-1) as [string, unknown[]];
    expect(sql).toContain('UPDATE user_profiles');
    expect(sql).toContain('email_ciphertext = $2');
    expect(sql).toContain('phone_ciphertext = $6');
    expect(sql).toContain('email = NULL');
    expect(sql).toContain('phone = NULL');
    expect(params).toContain('Ada Lovelace');
    expect(params).toContain(publicKey);
    expect(params).not.toContain('ada@example.com');
    expect(params).not.toContain('+15551234567');
  });

  it('rejects invalid patch payloads', async () => {
    const response = await request(app)
      .patch('/user/profile')
      .set('Authorization', `Bearer ${bearerToken()}`)
      .send({ email: 'not-an-email' });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Validation failed');
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated requests', async () => {
    const response = await request(app).get('/user/profile');

    expect(response.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });
});
