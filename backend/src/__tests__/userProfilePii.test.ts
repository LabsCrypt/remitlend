import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import request from 'supertest';

process.env.JWT_SECRET = 'user-profile-pii-test-secret';
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
const { encryptField } = await import('../services/piiCrypto.js');

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

function rowResult(rows: unknown[]) {
  return {
    rows,
    rowCount: rows.length,
    command: 'SELECT',
    oid: 0,
    fields: [],
  };
}

function updateCall(): [string, unknown[]] {
  const call = queryMock.mock.calls.find(([sql]) => String(sql).includes('UPDATE user_profiles'));

  if (!call) throw new Error('no UPDATE user_profiles statement was executed');

  return call as [string, unknown[]];
}

async function encryptedColumns(value: string, field: 'email' | 'phone') {
  const encrypted = await encryptField(value);

  return {
    [`${field}_ciphertext`]: encrypted.ciphertext,
    [`${field}_gcm_nonce`]: encrypted.gcm_nonce,
    [`${field}_dek_wrapped`]: encrypted.dek_wrapped,
    [`${field}_dek_kek_id`]: encrypted.dek_kek_id,
  };
}

describe('user profile PII envelope encryption (#1828)', () => {
  beforeEach(() => {
    queryMock.mockReset();
    poolQueryMock.mockReset();
    poolQueryMock.mockResolvedValue(rowResult([]));
  });

  it('stores the e-mail address and the phone number as an encrypted envelope', async () => {
    const email = await encryptedColumns('ada@example.com', 'email');
    const phone = await encryptedColumns('+15551234567', 'phone');

    queryMock.mockResolvedValueOnce(rowResult([profileRow()])).mockResolvedValueOnce(
      rowResult([
        profileRow({
          ...email,
          ...phone,
          email: null,
          phone: null,
        }),
      ]),
    );

    const response = await request(app)
      .patch('/user/profile')
      .set('Authorization', `Bearer ${bearerToken()}`)
      .send({ email: 'ada@example.com', phone: '+15551234567' });

    expect(response.status).toBe(200);
    // The owner still sees their own PII.
    expect(response.body).toMatchObject({
      email: 'ada@example.com',
      phone: '+15551234567',
    });

    const [sql, params] = updateCall();

    expect(sql).toContain('email_ciphertext = $1');
    expect(sql).toContain('email_gcm_nonce = $2');
    expect(sql).toContain('email_dek_wrapped = $3');
    expect(sql).toContain('email_dek_kek_id = $4');
    expect(sql).toContain('phone_ciphertext = $5');
    expect(sql).toContain('phone_gcm_nonce = $6');
    expect(sql).toContain('phone_dek_wrapped = $7');
    expect(sql).toContain('phone_dek_kek_id = $8');
    // The legacy plaintext columns are cleared in the same statement.
    expect(sql).toContain('email = NULL');
    expect(sql).toContain('phone = NULL');

    // The plaintext is not part of the statement.
    expect(params).not.toContain('ada@example.com');
    expect(params).not.toContain('+15551234567');
    // Three binary envelope columns per field, the KEK id stays readable.
    expect(params.filter((param) => Buffer.isBuffer(param))).toHaveLength(6);
    expect(params.filter((param) => param === 'test-kek')).toHaveLength(2);
  });

  it('never stores the plaintext in the database parameters', async () => {
    const email = await encryptedColumns('ada@example.com', 'email');

    queryMock
      .mockResolvedValueOnce(rowResult([profileRow()]))
      .mockResolvedValueOnce(rowResult([profileRow({ ...email, email: null })]));

    await request(app)
      .patch('/user/profile')
      .set('Authorization', `Bearer ${bearerToken()}`)
      .send({ email: 'ada@example.com' });

    const params = updateCall()[1];

    expect(
      JSON.stringify(
        params.map((param) => (Buffer.isBuffer(param) ? param.toString('base64') : param)),
      ),
    ).not.toContain('ada@example.com');
  });

  it('decrypts the stored PII when the profile is read and audits the access', async () => {
    const email = await encryptedColumns('ada@example.com', 'email');
    const phone = await encryptedColumns('+15551234567', 'phone');

    queryMock.mockResolvedValueOnce(
      rowResult([profileRow({ ...email, ...phone, email: null, phone: null })]),
    );

    const response = await request(app)
      .get('/user/profile')
      .set('Authorization', `Bearer ${bearerToken()}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      email: 'ada@example.com',
      phone: '+15551234567',
    });

    // Every decryption is written to the pii_access_log audit trail.
    const auditCalls = queryMock.mock.calls.filter(([sql]) =>
      String(sql).includes('INSERT INTO pii_access_log'),
    );
    expect(auditCalls).toHaveLength(2);
    const [auditSql, auditParams] = auditCalls[0] as [string, unknown[]];
    expect(auditSql).toContain('INSERT INTO pii_access_log');
    expect(auditParams).toContain('email');
    expect(auditParams).toContain(publicKey);
  });

  it('still serves profiles that were written before the encryption migration', async () => {
    queryMock.mockResolvedValueOnce(
      rowResult([profileRow({ email: 'legacy@example.com', phone: '+15550000000' })]),
    );

    const response = await request(app)
      .get('/user/profile')
      .set('Authorization', `Bearer ${bearerToken()}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      email: 'legacy@example.com',
      phone: '+15550000000',
    });
    // No decryption happened, so nothing was audited.
    expect(
      queryMock.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO pii_access_log')),
    ).toHaveLength(0);
  });

  it('clears the encrypted envelope when the user removes the value', async () => {
    queryMock
      .mockResolvedValueOnce(rowResult([profileRow()]))
      .mockResolvedValueOnce(rowResult([profileRow()]));

    const response = await request(app)
      .patch('/user/profile')
      .set('Authorization', `Bearer ${bearerToken()}`)
      .send({ email: null, phone: null });

    expect(response.status).toBe(200);

    const [sql] = updateCall();
    expect(sql).toContain('email_ciphertext = NULL');
    expect(sql).toContain('email_gcm_nonce = NULL');
    expect(sql).toContain('email_dek_wrapped = NULL');
    expect(sql).toContain('email_dek_kek_id = NULL');
    expect(sql).toContain('phone_ciphertext = NULL');
    expect(sql).toContain('phone = NULL');
  });
});
