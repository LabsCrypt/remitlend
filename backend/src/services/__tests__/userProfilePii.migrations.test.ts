import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

process.env.PII_KEK_KEY = '0'.repeat(64);
process.env.PII_KEK_ID = 'test-kek';

const mockQuery = jest.fn<(sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>>();

jest.unstable_mockModule('../../db/connection.js', () => ({
  withAdvisoryLock: async (_key: string, fn: () => Promise<unknown>) => fn(),
  default: { query: mockQuery },
  query: mockQuery,
  pool: { query: mockQuery },
  getClient: jest.fn(),
  withTransaction: jest.fn(),
}));

const { backfillUserProfilePii, encryptPiiValue, piiColumnNames, readPiiValue } =
  await import('../userProfilePii.js');

const ORIGINAL_KEK_KEY = process.env.PII_KEK_KEY;
const RECORD_ID = 'GUSER';
const CONTEXT = {
  recordId: RECORD_ID,
  actor: RECORD_ID,
  reason: 'migration regression test',
  requestId: 'req-pii-migration',
};

type BackfillRow = {
  public_key: string;
  email: string | null;
  phone: string | null;
  email_ciphertext: Buffer | null;
  phone_ciphertext: Buffer | null;
};

function selectResult(rows: BackfillRow[]) {
  return { rows };
}

function updateCall(index = 1): [string, unknown[]] {
  return mockQuery.mock.calls[index] as [string, unknown[]];
}

describe('user profile PII migration gaps (#2083)', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    process.env.PII_KEK_KEY = ORIGINAL_KEK_KEY;
  });

  afterEach(() => {
    process.env.PII_KEK_KEY = ORIGINAL_KEK_KEY;
  });

  it('maps each PII field to its four envelope columns', () => {
    expect(piiColumnNames('email')).toEqual({
      ciphertext: 'email_ciphertext',
      nonce: 'email_gcm_nonce',
      dek: 'email_dek_wrapped',
      kek: 'email_dek_kek_id',
    });
    expect(piiColumnNames('phone')).toEqual({
      ciphertext: 'phone_ciphertext',
      nonce: 'phone_gcm_nonce',
      dek: 'phone_dek_wrapped',
      kek: 'phone_dek_kek_id',
    });
  });

  it.each(['ciphertext', 'gcm_nonce', 'dek_wrapped', 'dek_kek_id'] as const)(
    'falls back to legacy plaintext when the envelope is missing %s',
    async (missing) => {
      const envelope = await encryptPiiValue('legacy@example.com');
      const row: Record<string, unknown> = {
        email: 'legacy@example.com',
        email_ciphertext: envelope.ciphertext,
        email_gcm_nonce: envelope.gcm_nonce,
        email_dek_wrapped: envelope.dek_wrapped,
        email_dek_kek_id: envelope.dek_kek_id,
      };
      delete row[`email_${missing}`];

      await expect(
        readPiiValue(row as Parameters<typeof readPiiValue>[0], 'email', CONTEXT),
      ).resolves.toBe('legacy@example.com');
      expect(mockQuery).not.toHaveBeenCalled();
    },
  );

  it('returns null for a partial envelope with no legacy value', async () => {
    const envelope = await encryptPiiValue('lost@example.com');

    await expect(
      readPiiValue(
        {
          email_ciphertext: envelope.ciphertext,
          email_gcm_nonce: envelope.gcm_nonce,
          email_dek_wrapped: null,
          email_dek_kek_id: envelope.dek_kek_id,
        },
        'email',
        CONTEXT,
      ),
    ).resolves.toBeNull();
  });

  it('decrypts a complete envelope and logs one access for it', async () => {
    const envelope = await encryptPiiValue('ada@example.com');

    const value = await readPiiValue(
      {
        email_ciphertext: envelope.ciphertext,
        email_gcm_nonce: envelope.gcm_nonce,
        email_dek_wrapped: envelope.dek_wrapped,
        email_dek_kek_id: envelope.dek_kek_id,
        phone: '+15551234567',
      },
      'email',
      CONTEXT,
    );

    expect(value).toBe('ada@example.com');
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0]![0]).toContain('INSERT INTO pii_access_log');
    expect(mockQuery.mock.calls[0]![1]).toEqual([
      RECORD_ID,
      RECORD_ID,
      'email',
      CONTEXT.reason,
      CONTEXT.requestId,
    ]);
  });

  it('encrypts only the plaintext field of a partially encrypted row', async () => {
    mockQuery
      .mockResolvedValueOnce(
        selectResult([
          {
            public_key: RECORD_ID,
            email: null,
            phone: '+15551234567',
            email_ciphertext: Buffer.from('already-encrypted'),
            phone_ciphertext: null,
          },
        ]),
      )
      .mockResolvedValueOnce({ rows: [] });

    await expect(backfillUserProfilePii()).resolves.toEqual({ scanned: 1, encrypted: 1 });

    const [sql, params] = updateCall();
    expect(sql).toContain('phone_ciphertext = $1');
    expect(sql).toContain('phone_gcm_nonce = $2');
    expect(sql).toContain('phone_dek_wrapped = $3');
    expect(sql).toContain('phone_dek_kek_id = $4');
    expect(sql).toContain('phone = NULL');
    expect(sql).toContain('WHERE public_key = $5');
    expect(sql).not.toContain('email_ciphertext =');
    expect(sql).not.toContain('email = NULL');
    expect(params).toHaveLength(5);
    expect(params[0]).toBeInstanceOf(Buffer);
    expect(params[1]).toBeInstanceOf(Buffer);
    expect(params[2]).toBeInstanceOf(Buffer);
    expect(params[3]).toBe('test-kek');
    expect(params[4]).toBe(RECORD_ID);
    expect(params).not.toContain('+15551234567');
  });

  it('skips an already encrypted field when only the other field is plaintext', async () => {
    mockQuery
      .mockResolvedValueOnce(
        selectResult([
          {
            public_key: RECORD_ID,
            email: 'ada@example.com',
            phone: null,
            email_ciphertext: null,
            phone_ciphertext: Buffer.from('already-encrypted'),
          },
        ]),
      )
      .mockResolvedValueOnce({ rows: [] });

    await expect(backfillUserProfilePii()).resolves.toEqual({ scanned: 1, encrypted: 1 });

    const [sql, params] = updateCall();
    expect(sql).toContain('email_ciphertext = $1');
    expect(sql).toContain('email = NULL');
    expect(sql).not.toContain('phone_ciphertext =');
    expect(sql).not.toContain('phone = NULL');
    expect(params.at(-1)).toBe(RECORD_ID);
    expect(params).not.toContain('ada@example.com');
  });

  it('counts a fully encrypted row as scanned but not encrypted', async () => {
    mockQuery.mockResolvedValueOnce(
      selectResult([
        {
          public_key: RECORD_ID,
          email: null,
          phone: null,
          email_ciphertext: Buffer.from('already-encrypted'),
          phone_ciphertext: Buffer.from('already-encrypted'),
        },
      ]),
    );

    await expect(backfillUserProfilePii()).resolves.toEqual({ scanned: 1, encrypted: 0 });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('handles several partially encrypted rows without mixing up their parameters', async () => {
    mockQuery
      .mockResolvedValueOnce(
        selectResult([
          {
            public_key: 'GONE',
            email: 'one@example.com',
            phone: null,
            email_ciphertext: null,
            phone_ciphertext: Buffer.from('already-encrypted'),
          },
          {
            public_key: 'GTWO',
            email: null,
            phone: '+15550000000',
            email_ciphertext: Buffer.from('already-encrypted'),
            phone_ciphertext: null,
          },
        ]),
      )
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(backfillUserProfilePii()).resolves.toEqual({ scanned: 2, encrypted: 2 });

    expect(mockQuery).toHaveBeenCalledTimes(3);
    expect(updateCall(1)[0]).toContain('email_ciphertext = $1');
    expect(updateCall(1)[1].at(-1)).toBe('GONE');
    expect(updateCall(2)[0]).toContain('phone_ciphertext = $1');
    expect(updateCall(2)[1].at(-1)).toBe('GTWO');
  });

  it('rejects a complete envelope when the KEK is missing without writing an audit row', async () => {
    const envelope = await encryptPiiValue('ada@example.com');
    delete process.env.PII_KEK_KEY;

    await expect(
      readPiiValue(
        {
          email_ciphertext: envelope.ciphertext,
          email_gcm_nonce: envelope.gcm_nonce,
          email_dek_wrapped: envelope.dek_wrapped,
          email_dek_kek_id: envelope.dek_kek_id,
        },
        'email',
        CONTEXT,
      ),
    ).rejects.toThrow(/PII_KEK_KEY is required/);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('aborts the backfill when the KEK is missing instead of issuing an UPDATE', async () => {
    mockQuery.mockResolvedValueOnce(
      selectResult([
        {
          public_key: RECORD_ID,
          email: 'ada@example.com',
          phone: null,
          email_ciphertext: null,
          phone_ciphertext: null,
        },
      ]),
    );
    delete process.env.PII_KEK_KEY;

    await expect(backfillUserProfilePii()).rejects.toThrow(/PII_KEK_KEY is required/);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0]![0]).toContain('SELECT public_key, email, phone');
  });
});
