import { jest, describe, it, expect, beforeEach } from '@jest/globals';

process.env.PII_KEK_KEY = '0'.repeat(64);
process.env.PII_KEK_ID = 'test-kek';

type MockQueryResult = { rows: unknown[]; rowCount?: number };

const mockQuery: jest.MockedFunction<
  (text: string, params?: unknown[]) => Promise<MockQueryResult>
> = jest.fn();

await jest.unstable_mockModule('../../db/connection.js', () => ({
  withAdvisoryLock: async (_key: string, fn: () => Promise<unknown>) => fn(),
  default: { query: mockQuery },
  query: mockQuery,
  pool: { query: mockQuery },
  getClient: jest.fn(),
  withTransaction: jest.fn(),
}));

const { backfillUserProfilePii, encryptPiiValue, readPiiValue } =
  await import('../userProfilePii.js');

describe('userProfilePii', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('encrypts a PII value into the envelope columns', async () => {
    const encrypted = await encryptPiiValue('ada@example.com');

    expect(encrypted.ciphertext).toBeInstanceOf(Buffer);
    expect(encrypted.gcm_nonce).toHaveLength(12);
    expect(encrypted.dek_wrapped).toBeInstanceOf(Buffer);
    expect(encrypted.dek_kek_id).toBe('test-kek');
    // The ciphertext must not contain the plaintext.
    expect(encrypted.ciphertext.toString('utf8')).not.toContain('ada@example.com');
  });

  it('reads a value that is stored as an encrypted envelope', async () => {
    const encrypted = await encryptPiiValue('ada@example.com');

    const value = await readPiiValue(
      {
        email_ciphertext: encrypted.ciphertext,
        email_gcm_nonce: encrypted.gcm_nonce,
        email_dek_wrapped: encrypted.dek_wrapped,
        email_dek_kek_id: encrypted.dek_kek_id,
      },
      'email',
      {
        recordId: 'GUSER',
        actor: 'GUSER',
        reason: 'test',
        requestId: 'req-1',
      },
    );

    expect(value).toBe('ada@example.com');
  });

  it('falls back to the legacy plaintext column for rows written before the migration', async () => {
    const value = await readPiiValue({ email: 'legacy@example.com' }, 'email', {
      recordId: 'GUSER',
      actor: 'GUSER',
      reason: 'test',
      requestId: 'req-1',
    });

    expect(value).toBe('legacy@example.com');
  });

  it('backfills the rows that still hold plaintext and clears the legacy columns', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          public_key: 'GUSER1',
          email: 'ada@example.com',
          phone: '+15551234567',
          email_ciphertext: null,
          phone_ciphertext: null,
        },
      ],
      rowCount: 1,
    });
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const result = await backfillUserProfilePii();

    expect(result).toEqual({ scanned: 1, encrypted: 1 });

    const [sql, params] = mockQuery.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain('UPDATE user_profiles');
    expect(sql).toContain('email_ciphertext = $1');
    expect(sql).toContain('email = NULL');
    expect(sql).toContain('phone = NULL');
    expect(params).not.toContain('ada@example.com');
    expect(params).not.toContain('+15551234567');
    expect(params?.at(-1)).toBe('GUSER1');
  });

  it('skips rows that are already encrypted', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const result = await backfillUserProfilePii();

    expect(result).toEqual({ scanned: 0, encrypted: 0 });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});
