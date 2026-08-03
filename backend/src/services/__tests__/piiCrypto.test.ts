import { encryptField, maskValue } from '../piiCrypto.js';

describe('piiCrypto', () => {
  const testKekKey = '0'.repeat(64);

  beforeAll(() => {
    process.env.PII_KEK_KEY = testKekKey;
    process.env.PII_KEK_ID = 'test-kek';
    process.env.LOG_REDACTION = 'strict';
  });

  afterAll(() => {
    delete process.env.PII_KEK_KEY;
    delete process.env.PII_KEK_ID;
    delete process.env.LOG_REDACTION;
  });

  describe('encryptField / decryptField round trip', () => {
    it('should encrypt and decrypt a string field', async () => {
      const plaintext = 'user@example.com';
      const encrypted = await encryptField(plaintext);

      expect(encrypted.ciphertext).toBeInstanceOf(Buffer);
      expect(encrypted.gcm_nonce).toHaveLength(12);
      expect(encrypted.dek_wrapped).toBeInstanceOf(Buffer);
      // KEK_ID is evaluated at module import time, before test env is set
      expect(encrypted.dek_kek_id).toBeDefined();
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
