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

  describe('Stellar memo limits', () => {
    it('accepts empty, ASCII, and multi-byte memos up to 28 UTF-8 bytes', async () => {
      const { isValidStellarMemo, assertValidStellarMemo } = await import('../stellar.js');
      const exactly28Bytes = '🚀'.repeat(7);

      expect(Buffer.byteLength(exactly28Bytes, 'utf8')).toBe(28);
      expect(isValidStellarMemo('')).toBe(true);
      expect(isValidStellarMemo('A'.repeat(28))).toBe(true);
      expect(isValidStellarMemo(exactly28Bytes)).toBe(true);
      expect(() => assertValidStellarMemo(exactly28Bytes)).not.toThrow();
    });

    it('rejects memos over 28 bytes and non-string values', async () => {
      const { isValidStellarMemo, assertValidStellarMemo } = await import('../stellar.js');
      const overLimit = '🚀'.repeat(8);

      expect(Buffer.byteLength(overLimit, 'utf8')).toBe(32);
      expect(isValidStellarMemo('A'.repeat(29))).toBe(false);
      expect(isValidStellarMemo(overLimit)).toBe(false);
      expect(isValidStellarMemo(null)).toBe(false);
      expect(isValidStellarMemo(undefined)).toBe(false);
      expect(isValidStellarMemo(123)).toBe(false);
      expect(() => assertValidStellarMemo('A'.repeat(29))).toThrow(
        'Invalid Stellar memo: maximum length is 28 bytes',
      );
    });
  });

  describe('Stellar asset codes', () => {
    it('accepts native/XLM and 1-12 alphanumeric codes', async () => {
      const { isValidAssetCode, assertValidAssetCode } = await import('../stellar.js');

      expect(isValidAssetCode('XLM')).toBe(true);
      expect(isValidAssetCode('native')).toBe(true);
      expect(isValidAssetCode('USDC')).toBe(true);
      expect(isValidAssetCode('A')).toBe(true);
      expect(isValidAssetCode('123456789012')).toBe(true);
      expect(() => assertValidAssetCode('USDC')).not.toThrow();
    });

    it('rejects invalid codes with the documented error contract', async () => {
      const { isValidAssetCode, assertValidAssetCode } = await import('../stellar.js');

      expect(isValidAssetCode('')).toBe(false);
      expect(isValidAssetCode('TOOLONGASSETCODE13')).toBe(false);
      expect(isValidAssetCode('USD-C')).toBe(false);
      expect(isValidAssetCode('USD C')).toBe(false);
      expect(isValidAssetCode('USDC$')).toBe(false);
      expect(isValidAssetCode(null)).toBe(false);
      expect(isValidAssetCode(100)).toBe(false);
      expect(() => assertValidAssetCode('TOOLONGASSETCODE13')).toThrow(
        'Invalid Stellar asset code: must be 1-12 alphanumeric characters or native',
      );
    });
  });

  describe('Stellar amount parsing', () => {
    it('converts decimal amounts to exact stroops and formats at stroop precision', async () => {
      const { parseStellarAmount, formatStellarAmount } = await import('../stellar.js');

      expect(parseStellarAmount('10')).toBe(100000000n);
      expect(parseStellarAmount('0.0000001')).toBe(1n);
      expect(parseStellarAmount(1.5)).toBe(15000000n);
      expect(parseStellarAmount(1e-7)).toBe(1n);
      expect(formatStellarAmount(0)).toBe('0.0000000');
      expect(formatStellarAmount('25.5')).toBe('25.5000000');
      expect(formatStellarAmount('1.12345674')).toBe('1.1234567');
      expect(formatStellarAmount('1.12345678')).toBe('1.1234568');
    });

    it('uses the repository half-even policy by default and supports explicit half-up', async () => {
      const { parseStellarAmount } = await import('../stellar.js');
      const { RoundingMode } = await import('../../money/decimal.js');

      expect(parseStellarAmount('0.00000005')).toBe(0n);
      expect(parseStellarAmount('0.00000015')).toBe(2n);
      expect(parseStellarAmount('0.00000005', RoundingMode.HalfUp)).toBe(1n);
    });

    it('rejects malformed, negative, and non-finite amounts', async () => {
      const { parseStellarAmount, formatStellarAmount } = await import('../stellar.js');

      expect(() => parseStellarAmount('abc')).toThrow('Invalid Stellar amount');
      expect(() => parseStellarAmount('')).toThrow('Invalid Stellar amount');
      expect(() => parseStellarAmount(-1)).toThrow('Invalid Stellar amount');
      expect(() => parseStellarAmount(Infinity)).toThrow('Invalid Stellar amount');
      expect(() => formatStellarAmount(NaN)).toThrow('Invalid Stellar amount');
    });
  });
});
