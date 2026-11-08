import { jest } from '@jest/globals';

describe('Stellar utils', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('isValidStellarAddress', () => {
    it('returns true for a valid 56-char G... address', async () => {
      const { isValidStellarAddress } = await import('../stellar.js');
      const validAddress = 'GBUQWP3BOUZX34ULNQG23RQ6F4BVWCIBTLFL2F7HVRQG5LDHNWY2QTWA';
      expect(isValidStellarAddress(validAddress)).toBe(true);
    });

    it('returns false for wrong length / wrong prefix / lowercase / invalid base32', async () => {
      const { isValidStellarAddress } = await import('../stellar.js');

      expect(isValidStellarAddress('')).toBe(false);
      expect(isValidStellarAddress('G'.repeat(55))).toBe(false);
      expect(isValidStellarAddress('G'.repeat(57))).toBe(false);
      expect(isValidStellarAddress('A'.repeat(56))).toBe(false);
      expect(
        isValidStellarAddress('gbuqwp3bouzx34ulnqg23rq6f4bvwcibtlfl2f7hvrqg5ldhnwy2qtwa'),
      ).toBe(false);
      expect(isValidStellarAddress(`G${'A'.repeat(50)}0123`)).toBe(false);
    });

    it('returns false for non-string values', async () => {
      const { isValidStellarAddress } = await import('../stellar.js');
      expect(isValidStellarAddress(null)).toBe(false);
      expect(isValidStellarAddress(undefined)).toBe(false);
      expect(isValidStellarAddress(123)).toBe(false);
      expect(isValidStellarAddress({})).toBe(false);
    });
  });

  describe('assertValidStellarAddress', () => {
    it('throws on invalid', async () => {
      const { assertValidStellarAddress } = await import('../stellar.js');
      expect(() => assertValidStellarAddress('not-an-address')).toThrow('Invalid Stellar address');
    });

    it('passes through valid', async () => {
      const { assertValidStellarAddress } = await import('../stellar.js');
      const validAddress = 'GBHVTBKMJ5PXJW7VDBLCWVYXCXU6BFJFNX4S3HJQEWQYXU2CKFCW4FAA';
      expect(() => assertValidStellarAddress(validAddress)).not.toThrow();
    });
  });

  describe('getTxUrl / getAccountUrl', () => {
    it('builds explorer URLs and honors STELLAR_EXPLORER_URL', async () => {
      process.env.STELLAR_EXPLORER_URL = 'https://example.com/explorer';
      jest.resetModules();
      const { getTxUrl, getAccountUrl } = await import('../stellar.js');

      expect(getTxUrl('txhash')).toBe('https://example.com/explorer/tx/txhash');
      expect(getAccountUrl('GABC')).toBe('https://example.com/explorer/account/GABC');
    });
  });

  describe('Stellar memo limits & validation boundaries (#2089)', () => {
    it('accepts valid memos within 28 bytes', async () => {
      const { isValidStellarMemo, assertValidStellarMemo } = await import('../stellar.js');

      expect(isValidStellarMemo('')).toBe(true);
      expect(isValidStellarMemo('Invoice #1234')).toBe(true);
      expect(isValidStellarMemo('A'.repeat(28))).toBe(true);
      expect(() => assertValidStellarMemo('A'.repeat(28))).not.toThrow();
    });

    it('rejects memos exceeding 28 bytes', async () => {
      const { isValidStellarMemo, assertValidStellarMemo } = await import('../stellar.js');

      // 29 ASCII characters = 29 bytes
      expect(isValidStellarMemo('A'.repeat(29))).toBe(false);
      expect(() => assertValidStellarMemo('A'.repeat(29))).toThrow(
        'Invalid Stellar memo: maximum length is 28 bytes',
      );
    });

    it('correctly calculates UTF-8 multi-byte characters against the 28-byte boundary', async () => {
      const { isValidStellarMemo } = await import('../stellar.js');

      // 7 emojis (4 bytes each) = 28 bytes -> valid
      const exactly28Bytes = '🚀'.repeat(7);
      expect(Buffer.byteLength(exactly28Bytes, 'utf8')).toBe(28);
      expect(isValidStellarMemo(exactly28Bytes)).toBe(true);

      // 8 emojis (4 bytes each) = 32 bytes -> invalid
      const exceeds28Bytes = '🚀'.repeat(8);
      expect(Buffer.byteLength(exceeds28Bytes, 'utf8')).toBe(32);
      expect(isValidStellarMemo(exceeds28Bytes)).toBe(false);
    });

    it('rejects null, undefined, or non-string memo inputs', async () => {
      const { isValidStellarMemo } = await import('../stellar.js');

      expect(isValidStellarMemo(null)).toBe(false);
      expect(isValidStellarMemo(undefined)).toBe(false);
      expect(isValidStellarMemo(12345)).toBe(false);
      expect(isValidStellarMemo({})).toBe(false);
    });
  });

  describe('Stellar asset code validation (#2089)', () => {
    it('accepts valid 1-12 alphanumeric asset codes and native/XLM', async () => {
      const { isValidAssetCode, assertValidAssetCode } = await import('../stellar.js');

      expect(isValidAssetCode('XLM')).toBe(true);
      expect(isValidAssetCode('native')).toBe(true);
      expect(isValidAssetCode('USDC')).toBe(true);
      expect(isValidAssetCode('EURC')).toBe(true);
      expect(isValidAssetCode('PHP')).toBe(true);
      expect(isValidAssetCode('A')).toBe(true);
      expect(isValidAssetCode('123456789012')).toBe(true);
      expect(() => assertValidAssetCode('USDC')).not.toThrow();
    });

    it('rejects asset codes longer than 12 characters', async () => {
      const { isValidAssetCode, assertValidAssetCode } = await import('../stellar.js');

      expect(isValidAssetCode('TOOLONGASSETCODE13')).toBe(false);
      expect(() => assertValidAssetCode('TOOLONGASSETCODE13')).toThrow(
        'Invalid Stellar asset code: must be 1-12 alphanumeric characters or native',
      );
    });

    it('rejects asset codes with spaces, special characters, or invalid types', async () => {
      const { isValidAssetCode } = await import('../stellar.js');

      expect(isValidAssetCode('')).toBe(false);
      expect(isValidAssetCode('USD-C')).toBe(false);
      expect(isValidAssetCode('USD C')).toBe(false);
      expect(isValidAssetCode('USDC$')).toBe(false);
      expect(isValidAssetCode(null)).toBe(false);
      expect(isValidAssetCode(undefined)).toBe(false);
      expect(isValidAssetCode(100)).toBe(false);
    });
  });

  describe('Stellar amount formatting & decimal rounding (#2089)', () => {
    it('formats amounts with exact 7-decimal precision (stroops representation)', async () => {
      const { formatStellarAmount, parseStellarAmount } = await import('../stellar.js');

      expect(formatStellarAmount(10)).toBe('10.0000000');
      expect(formatStellarAmount('25.5')).toBe('25.5000000');
      expect(formatStellarAmount(0)).toBe('0.0000000');
      expect(parseStellarAmount('10')).toBe(100000000n);
      expect(parseStellarAmount(1.5)).toBe(15000000n);
      expect(parseStellarAmount('0.0000001')).toBe(1n);
    });

    it('applies standard half-up decimal rounding to avoid floating-point inaccuracies', async () => {
      const { formatStellarAmount } = await import('../stellar.js');

      // Rounds half-up beyond 7 decimals
      expect(formatStellarAmount(1.12345674)).toBe('1.1234567');
      expect(formatStellarAmount(1.12345678)).toBe('1.1234568');
      expect(formatStellarAmount(0.00000004)).toBe('0.0000000');
      expect(formatStellarAmount(0.00000005)).toBe('0.0000001');
    });

    it('rejects negative, NaN, or non-finite amount values', async () => {
      const { formatStellarAmount, parseStellarAmount } = await import('../stellar.js');

      expect(() => formatStellarAmount(-5)).toThrow('Invalid Stellar amount');
      expect(() => formatStellarAmount('abc')).toThrow('Invalid Stellar amount');
      expect(() => formatStellarAmount(Infinity)).toThrow('Invalid Stellar amount');
      expect(() => parseStellarAmount(-1)).toThrow('Invalid Stellar amount');
    });
  });
});
