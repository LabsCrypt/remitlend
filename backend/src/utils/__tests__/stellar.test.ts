import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

describe('Stellar utils', () => {
  const originalEnv = { ...process.env };

  const VALID_ADDRESS_1 = 'GDNBM6SDOYSDUXN23VBBNB3O3I6USAYAZMZR7BDR5MEHO57OVGW4MKLQ';
  const VALID_ADDRESS_2 = 'GB6W2HAURAPJI3FYNPSAB5IMPZVFJMV2CZGWWFNE446VGOVT46AJMKDH';
  const VALID_ADDRESS_3 = 'GBAYSVXGTONMNL622O2XA63PVW4MRMNCLZBGFXY46P3FSQMHW3IASRZW';

  // Format-valid (56 chars, starts with G, uppercase base32 alphabet), but CRC16 checksum is invalid:
  const CHECKSUM_INVALID_ADDRESS_1 = 'GBUQWP3BOUZX34ULNQG23RQ6F4BVWCIBTLFL2F7HVRQG5LDHNWY2QTWA';
  const CHECKSUM_INVALID_ADDRESS_2 = 'GBHVTBKMJ5PXJW7VDBLCWVYXCXU6BFJFNX4S3HJQEWQYXU2CKFCW4FAA';
  // VALID_ADDRESS_1 with last character modified from Q to R:
  const CHECKSUM_INVALID_ADDRESS_3 = 'GDNBM6SDOYSDUXN23VBBNB3O3I6USAYAZMZR7BDR5MEHO57OVGW4MKLR';

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('isValidStellarAddress', () => {
    it('returns true for valid 56-char G... addresses with valid checksums', async () => {
      const { isValidStellarAddress } = await import('../stellar.js');

      expect(isValidStellarAddress(VALID_ADDRESS_1)).toBe(true);
      expect(isValidStellarAddress(VALID_ADDRESS_2)).toBe(true);
      expect(isValidStellarAddress(VALID_ADDRESS_3)).toBe(true);
    });

    it('returns false for format-valid but checksum-invalid addresses (#1868)', async () => {
      const { isValidStellarAddress } = await import('../stellar.js');

      // Verify each address is 56 chars, starts with G, and matches the basic regex
      const basicRegex = /^G[A-Z2-7]{55}$/;
      expect(basicRegex.test(CHECKSUM_INVALID_ADDRESS_1)).toBe(true);
      expect(basicRegex.test(CHECKSUM_INVALID_ADDRESS_2)).toBe(true);
      expect(basicRegex.test(CHECKSUM_INVALID_ADDRESS_3)).toBe(true);

      // But isValidStellarAddress must reject them due to invalid checksum
      expect(isValidStellarAddress(CHECKSUM_INVALID_ADDRESS_1)).toBe(false);
      expect(isValidStellarAddress(CHECKSUM_INVALID_ADDRESS_2)).toBe(false);
      expect(isValidStellarAddress(CHECKSUM_INVALID_ADDRESS_3)).toBe(false);
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

    it('returns false for non-ed25519 Stellar StrKey types (contracts, secrets)', async () => {
      const { isValidStellarAddress } = await import('../stellar.js');

      // Contract address (starts with C)
      expect(
        isValidStellarAddress('CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5CVUPJSIISDU4OOL'),
      ).toBe(false);
      // Secret seed (starts with S)
      expect(
        isValidStellarAddress('SBGWSG6BTNCKCOB3DIFBGCVMUPQFYPA2G4O3GJB37WUEZ7Y6DFC7VCIA'),
      ).toBe(false);
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
    it('throws on invalid format or invalid checksum', async () => {
      const { assertValidStellarAddress } = await import('../stellar.js');
      expect(() => assertValidStellarAddress('not-an-address')).toThrow('Invalid Stellar address');
      expect(() => assertValidStellarAddress(CHECKSUM_INVALID_ADDRESS_1)).toThrow(
        'Invalid Stellar address',
      );
      expect(() =>
        assertValidStellarAddress(CHECKSUM_INVALID_ADDRESS_1, 'Custom error message'),
      ).toThrow('Custom error message');
    });

    it('passes through valid', async () => {
      const { assertValidStellarAddress } = await import('../stellar.js');
      expect(() => assertValidStellarAddress(VALID_ADDRESS_1)).not.toThrow();
      expect(() => assertValidStellarAddress(VALID_ADDRESS_2)).not.toThrow();
    });
  });

  describe('getTxUrl / getAccountUrl', () => {
    it('builds explorer URLs and honors STELLAR_EXPLORER_URL', async () => {
      process.env.STELLAR_EXPLORER_URL = 'https://example.com/explorer';
      if (typeof jest?.resetModules === 'function') {
        jest.resetModules();
      }
      const { getTxUrl, getAccountUrl } = await import('../stellar.js');

      expect(getTxUrl('txhash')).toBe('https://example.com/explorer/tx/txhash');
      expect(getAccountUrl('GABC')).toBe('https://example.com/explorer/account/GABC');
    });
  });
});
