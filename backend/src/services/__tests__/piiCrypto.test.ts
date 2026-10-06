import { jest, describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { encryptField, decryptField, maskValue } from '../piiCrypto.js';
import { pool } from '../../db/connection.js';

describe('piiCrypto', () => {
  const testKekKey = '0'.repeat(64);
  let mockQuery: ReturnType<typeof jest.spyOn>;

  beforeAll(() => {
    process.env.PII_KEK_KEY = testKekKey;
    process.env.PII_KEK_ID = 'test-kek';
    process.env.LOG_REDACTION = 'strict';
    mockQuery = jest.spyOn(pool, 'query').mockImplementation(async () => {
      return { rows: [], rowCount: 1 } as unknown as ReturnType<typeof pool.query>;
    });
  });

  afterAll(() => {
    delete process.env.PII_KEK_KEY;
    delete process.env.PII_KEK_ID;
    delete process.env.LOG_REDACTION;
    mockQuery.mockRestore();
  });

  beforeEach(() => {
    mockQuery.mockClear();
  });

  describe('encryptField / decryptField round trip', () => {
    it('should encrypt and decrypt a string field recovering original plaintext', async () => {
      const plaintext = 'user@example.com';
      const encrypted = await encryptField(plaintext);

      expect(encrypted.ciphertext).toBeInstanceOf(Buffer);
      expect(encrypted.gcm_nonce).toHaveLength(12);
      expect(encrypted.dek_wrapped).toBeInstanceOf(Buffer);
      expect(encrypted.dek_kek_id).toBeDefined();

      const decrypted = await decryptField(
        'rec-123',
        'email',
        encrypted.ciphertext,
        encrypted.gcm_nonce,
        encrypted.dek_wrapped,
        encrypted.dek_kek_id,
        'actor-alice',
        'customer support inquiry',
        'req-xyz-456',
      );

      expect(decrypted).toBe(plaintext);
    });

    it('should write an audit log row to pii_access_log with actor, recordId, field, reason, and requestId', async () => {
      const plaintext = 'sensitive-data';
      const encrypted = await encryptField(plaintext);

      await decryptField(
        'record-999',
        'phone',
        encrypted.ciphertext,
        encrypted.gcm_nonce,
        encrypted.dek_wrapped,
        encrypted.dek_kek_id,
        'admin-bob',
        'verification',
        'req-audit-789',
      );

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO pii_access_log');
      expect(params).toEqual(['admin-bob', 'record-999', 'phone', 'verification', 'req-audit-789']);
    });

    it('should throw when ciphertext is corrupted', async () => {
      const plaintext = 'secret-phone-number';
      const encrypted = await encryptField(plaintext);

      const corruptedCiphertext = Buffer.from(encrypted.ciphertext);
      corruptedCiphertext[0] ^= 0xff;

      await expect(
        decryptField(
          'rec-1',
          'phone',
          corruptedCiphertext,
          encrypted.gcm_nonce,
          encrypted.dek_wrapped,
          encrypted.dek_kek_id,
          'actor',
          'reason',
          'req-id',
        ),
      ).rejects.toThrow();
    });

    it('should throw when auth tag is corrupted', async () => {
      const plaintext = 'secret-recipient-name';
      const encrypted = await encryptField(plaintext);

      const corruptedTag = Buffer.from(encrypted.ciphertext);
      corruptedTag[corruptedTag.length - 1] ^= 0xff;

      await expect(
        decryptField(
          'rec-1',
          'name',
          corruptedTag,
          encrypted.gcm_nonce,
          encrypted.dek_wrapped,
          encrypted.dek_kek_id,
          'actor',
          'reason',
          'req-id',
        ),
      ).rejects.toThrow();
    });

    it('should throw if PII_KEK_KEY is missing during local unwrap/wrap', async () => {
      const savedKey = process.env.PII_KEK_KEY;
      delete process.env.PII_KEK_KEY;

      try {
        await expect(encryptField('plaintext')).rejects.toThrow(
          'PII_KEK_KEY is required for local KEK wrapping but is not set',
        );
      } finally {
        process.env.PII_KEK_KEY = savedKey;
      }
    });
  });

  describe('KMS_ENDPOINT branch', () => {
    const KMS_URL = 'http://kms.internal.test';
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      delete process.env.PII_KMS_ENDPOINT;
      globalThis.fetch = originalFetch;
    });

    it('successfully wraps and unwraps DEK via KMS endpoint', async () => {
      process.env.PII_KMS_ENDPOINT = KMS_URL;

      let storedRawKeyBase64 = '';

      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = url.toString();
        const body = JSON.parse((init?.body as string) || '{}');

        if (urlStr.endsWith('/encrypt')) {
          storedRawKeyBase64 = body.plaintext;
          return {
            ok: true,
            status: 200,
            json: async () => ({
              wrapped_key: Buffer.from('kms-wrapped:' + body.plaintext).toString('base64'),
            }),
          } as Response;
        }

        if (urlStr.endsWith('/decrypt')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ plaintext: storedRawKeyBase64 }),
          } as Response;
        }

        return { ok: false, status: 404 } as Response;
      }) as typeof fetch;

      const plaintext = 'kms-protected@example.com';
      const encrypted = await encryptField(plaintext);

      const decrypted = await decryptField(
        'kms-rec-1',
        'email',
        encrypted.ciphertext,
        encrypted.gcm_nonce,
        encrypted.dek_wrapped,
        encrypted.dek_kek_id,
        'kms-actor',
        'testing',
        'req-kms-1',
      );

      expect(decrypted).toBe(plaintext);
    });

    it('throws when KMS wrap returns a non-OK status', async () => {
      process.env.PII_KMS_ENDPOINT = KMS_URL;

      globalThis.fetch = (async () => {
        return {
          ok: false,
          status: 503,
        } as Response;
      }) as typeof fetch;

      await expect(encryptField('test-fail')).rejects.toThrow('KMS wrap failed: 503');
    });

    it('throws when KMS unwrap returns a non-OK status', async () => {
      // First encrypt locally with local KEK
      delete process.env.PII_KMS_ENDPOINT;
      const encrypted = await encryptField('test-fail-unwrap');

      // Then configure KMS for decrypt and fail
      process.env.PII_KMS_ENDPOINT = KMS_URL;
      globalThis.fetch = (async () => {
        return {
          ok: false,
          status: 500,
        } as Response;
      }) as typeof fetch;

      await expect(
        decryptField(
          'rec-1',
          'email',
          encrypted.ciphertext,
          encrypted.gcm_nonce,
          encrypted.dek_wrapped,
          encrypted.dek_kek_id,
          'actor',
          'reason',
          'req-1',
        ),
      ).rejects.toThrow('KMS unwrap failed: 500');
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
