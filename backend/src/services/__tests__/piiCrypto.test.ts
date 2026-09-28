import { jest, describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';

const mockPoolQuery = jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.unstable_mockModule('../../db/connection.js', () => ({
  pool: {
    query: mockPoolQuery,
  },
}));

const { encryptField, decryptField, maskValue } = await import('../piiCrypto.js');

describe('piiCrypto', () => {
  const testKekKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const originalFetch = globalThis.fetch;

  beforeAll(() => {
    process.env.PII_KEK_KEY = testKekKey;
    process.env.PII_KEK_ID = 'test-kek';
    process.env.LOG_REDACTION = 'strict';
    delete process.env.PII_KMS_ENDPOINT;
  });

  afterAll(() => {
    delete process.env.PII_KEK_KEY;
    delete process.env.PII_KEK_ID;
    delete process.env.LOG_REDACTION;
    delete process.env.PII_KMS_ENDPOINT;
    globalThis.fetch = originalFetch;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockPoolQuery.mockResolvedValue({ rows: [], rowCount: 1 });
  });

  describe('encryptField / decryptField round trip', () => {
    it('should encrypt and decrypt a string field recovering original plaintext', async () => {
      const plaintext = 'user@example.com';
      const encrypted = await encryptField(plaintext);

      expect(encrypted.ciphertext).toBeInstanceOf(Buffer);
      expect(encrypted.gcm_nonce).toHaveLength(12);
      expect(encrypted.dek_wrapped).toBeInstanceOf(Buffer);
      expect(encrypted.dek_kek_id).toBe('test-kek');

      const decrypted = await decryptField(
        'rec-001',
        'email',
        encrypted.ciphertext,
        encrypted.gcm_nonce,
        encrypted.dek_wrapped,
        encrypted.dek_kek_id,
        'actor-admin',
        'compliance inspection',
        'req-xyz-123',
      );

      expect(decrypted).toBe(plaintext);
    });

    it('asserts decryptField writes a row to pii_access_log with actor, reason, and requestId', async () => {
      const plaintext = '+14155552671';
      const encrypted = await encryptField(plaintext);

      await decryptField(
        'rec-999',
        'phone',
        encrypted.ciphertext,
        encrypted.gcm_nonce,
        encrypted.dek_wrapped,
        encrypted.dek_kek_id,
        'operator-agent-7',
        'support escalation',
        'req-trace-888',
      );

      expect(mockPoolQuery).toHaveBeenCalledTimes(1);
      expect(mockPoolQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO pii_access_log'),
        ['operator-agent-7', 'rec-999', 'phone', 'support escalation', 'req-trace-888'],
      );
    });

    it('corrupts ciphertext and asserts decryptField throws authentication tag error rather than returning wrong plaintext', async () => {
      const plaintext = 'Alice Smith';
      const encrypted = await encryptField(plaintext);

      // Corrupt byte in ciphertext payload (before the 16-byte auth tag)
      const corruptedCiphertext = Buffer.from(encrypted.ciphertext);
      corruptedCiphertext[0] = corruptedCiphertext[0]! ^ 0xff;

      await expect(
        decryptField(
          'rec-002',
          'name',
          corruptedCiphertext,
          encrypted.gcm_nonce,
          encrypted.dek_wrapped,
          encrypted.dek_kek_id,
          'actor-1',
          'test',
          'req-1',
        ),
      ).rejects.toThrow();
    });

    it('corrupts auth tag and asserts decryptField throws authentication tag error', async () => {
      const plaintext = 'Bob Jones';
      const encrypted = await encryptField(plaintext);

      // Corrupt byte in the last 16 bytes (the GCM auth tag)
      const corruptedTag = Buffer.from(encrypted.ciphertext);
      corruptedTag[corruptedTag.length - 1] = corruptedTag[corruptedTag.length - 1]! ^ 0xff;

      await expect(
        decryptField(
          'rec-003',
          'name',
          corruptedTag,
          encrypted.gcm_nonce,
          encrypted.dek_wrapped,
          encrypted.dek_kek_id,
          'actor-1',
          'test',
          'req-1',
        ),
      ).rejects.toThrow();
    });

    it('corrupts dek_wrapped and asserts decryptField throws error during KEK unwrapping', async () => {
      const plaintext = 'secret data';
      const encrypted = await encryptField(plaintext);

      const corruptedWrappedDek = Buffer.from(encrypted.dek_wrapped);
      corruptedWrappedDek[corruptedWrappedDek.length - 1] =
        corruptedWrappedDek[corruptedWrappedDek.length - 1]! ^ 0xff;

      await expect(
        decryptField(
          'rec-004',
          'name',
          encrypted.ciphertext,
          encrypted.gcm_nonce,
          corruptedWrappedDek,
          encrypted.dek_kek_id,
          'actor-1',
          'test',
          'req-1',
        ),
      ).rejects.toThrow();
    });
  });

  describe('missing PII_KEK_KEY error handling', () => {
    it('throws when PII_KEK_KEY is not set for local wrapping', async () => {
      const savedKey = process.env.PII_KEK_KEY;
      delete process.env.PII_KEK_KEY;

      try {
        await expect(encryptField('test-data')).rejects.toThrow(
          'PII_KEK_KEY is required for local KEK wrapping but is not set',
        );
      } finally {
        process.env.PII_KEK_KEY = savedKey;
      }
    });

    it('throws when PII_KEK_KEY is not set for local unwrapping', async () => {
      const encrypted = await encryptField('test-data');
      const savedKey = process.env.PII_KEK_KEY;
      delete process.env.PII_KEK_KEY;

      try {
        await expect(
          decryptField(
            'rec-1',
            'email',
            encrypted.ciphertext,
            encrypted.gcm_nonce,
            encrypted.dek_wrapped,
            encrypted.dek_kek_id,
            'actor-1',
            'test',
            'req-1',
          ),
        ).rejects.toThrow('PII_KEK_KEY is required for local KEK unwrapping but is not set');
      } finally {
        process.env.PII_KEK_KEY = savedKey;
      }
    });
  });

  describe('KMS_ENDPOINT remote wrap/unwrap branch', () => {
    const mockKmsEndpoint = 'http://kms.internal:8080';

    beforeEach(() => {
      process.env.PII_KMS_ENDPOINT = mockKmsEndpoint;
    });

    afterEach(() => {
      delete process.env.PII_KMS_ENDPOINT;
      globalThis.fetch = originalFetch;
    });

    it('successfully encrypts and decrypts via remote KMS endpoints', async () => {
      let storedPlaintextBase64 = '';

      globalThis.fetch = jest.fn(async (input: unknown, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/encrypt')) {
          const body = JSON.parse(init?.body as string);
          storedPlaintextBase64 = body.plaintext;
          return {
            ok: true,
            status: 200,
            json: async () => ({
              wrapped_key: Buffer.from('kms-wrapped-dek-token').toString('base64'),
            }),
          } as Response;
        }
        if (url.endsWith('/decrypt')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ plaintext: storedPlaintextBase64 }),
          } as Response;
        }
        return { ok: false, status: 404 } as Response;
      }) as unknown as typeof fetch;

      const plaintext = 'sensitive-pii-kms-roundtrip@remitlend.io';
      const encrypted = await encryptField(plaintext);

      expect(encrypted.dek_wrapped.toString('utf8')).toBe('kms-wrapped-dek-token');

      const decrypted = await decryptField(
        'rec-kms-1',
        'email',
        encrypted.ciphertext,
        encrypted.gcm_nonce,
        encrypted.dek_wrapped,
        'kms-kek-v1',
        'kms-actor',
        'kms-test',
        'req-kms-99',
      );

      expect(decrypted).toBe(plaintext);
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });

    it('throws error when KMS wrap endpoint returns non-OK response', async () => {
      globalThis.fetch = jest.fn(async () => {
        return {
          ok: false,
          status: 500,
        } as Response;
      }) as unknown as typeof fetch;

      await expect(encryptField('test-data')).rejects.toThrow('KMS wrap failed: 500');
    });

    it('throws error when KMS unwrap endpoint returns non-OK response', async () => {
      // First encrypt locally
      delete process.env.PII_KMS_ENDPOINT;
      const encrypted = await encryptField('test-data');

      // Now enable KMS and simulate 503 Service Unavailable on unwrap
      process.env.PII_KMS_ENDPOINT = mockKmsEndpoint;
      globalThis.fetch = jest.fn(async () => {
        return {
          ok: false,
          status: 503,
        } as Response;
      }) as unknown as typeof fetch;

      await expect(
        decryptField(
          'rec-1',
          'email',
          encrypted.ciphertext,
          encrypted.gcm_nonce,
          encrypted.dek_wrapped,
          'kms-kek',
          'actor-1',
          'reason',
          'req-1',
        ),
      ).rejects.toThrow('KMS unwrap failed: 503');
    });
  });

  describe('maskValue', () => {
    it('should mask email correctly', () => {
      const masked = maskValue('john.doe@example.com', 'email');
      expect(masked).toMatch(/^j\*\*\*@e\*\*\*\.com$/);
    });

    it('should mask short email correctly', () => {
      const masked = maskValue('a@b.com', 'email');
      expect(masked).toMatch(/^a\*\*\*@b\*\*\*\.com$/);
    });

    it('should mask invalid email without domain correctly', () => {
      const masked = maskValue('not-an-email', 'email');
      expect(masked).toBe('***');
    });

    it('should mask phone correctly', () => {
      const masked = maskValue('+14155551234', 'phone');
      expect(masked).toBe('+xx...****34');
    });

    it('should mask short phone correctly', () => {
      const masked = maskValue('123', 'phone');
      expect(masked).toBe('****');
    });

    it('should mask name correctly', () => {
      const masked = maskValue('John Doe', 'name');
      expect(masked).toBe('J***e');
    });

    it('should mask single char name correctly', () => {
      const masked = maskValue('X', 'name');
      expect(masked).toBe('*');
    });
  });
});
