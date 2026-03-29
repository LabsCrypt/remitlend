import { isValidStellarAddress } from "./stellar";

describe("Stellar Utilities", () => {
  describe("isValidStellarAddress", () => {
    it("should validate a correct Stellar address", () => {
      const validAddress = "GBUQWP3BOUZX34ULNQG23RQ6F4BVWCIBTLFL2F7HVRQG5LDHNWY2QTW";
      expect(isValidStellarAddress(validAddress)).toBe(true);
    });

    it("should validate another correct Stellar address", () => {
      const validAddress = "GBHVTBKMJ5PXJW7VDBLCWVYXCXU6BFJFNX4S3HJQEWQYXU2CKFCW4F";
      expect(isValidStellarAddress(validAddress)).toBe(true);
    });

    it("should reject an address that is too short", () => {
      const invalidAddress = "GBUQWP3BOUZX34ULNQG23RQ6F4BVWCIBTL";
      expect(isValidStellarAddress(invalidAddress)).toBe(false);
    });

    it("should reject an address that is too long", () => {
      const invalidAddress = "GBUQWP3BOUZX34ULNQG23RQ6F4BVWCIBTLFL2F7HVRQG5LDHNWY2QTWEXTRA";
      expect(isValidStellarAddress(invalidAddress)).toBe(false);
    });

    it("should reject an address that doesn't start with G", () => {
      const invalidAddress = "ABUQWP3BOUZX34ULNQG23RQ6F4BVWCIBTLFL2F7HVRQG5LDHNWY2QTW";
      expect(isValidStellarAddress(invalidAddress)).toBe(false);
    });

    it("should reject an address with invalid characters", () => {
      const invalidAddress = "GBUQWP3BOUZX34ULNQG23RQ6F4BVWCIBTLFL2F7HVRQG5LDHNWY2QT!";
      expect(isValidStellarAddress(invalidAddress)).toBe(false);
    });

    it("should reject lowercase letters", () => {
      const invalidAddress = "gbuqwp3bouzx34ulnqg23rq6f4bvwcibtlfl2f7hvrqg5ldhnwy2qtw";
      expect(isValidStellarAddress(invalidAddress)).toBe(false);
    });

    it("should reject empty string", () => {
      expect(isValidStellarAddress("")).toBe(false);
    });

    it("should reject null or undefined", () => {
      expect(isValidStellarAddress(null as unknown as string)).toBe(false);
      expect(isValidStellarAddress(undefined as unknown as string)).toBe(false);
    });

    it("should reject non-string types", () => {
      expect(isValidStellarAddress(123 as unknown as string)).toBe(false);
      expect(isValidStellarAddress({} as unknown as string)).toBe(false);
    });

    it("should reject addresses with spaces", () => {
      const invalidAddress = "GBUQWP3BOUZX34ULNQG23RQ6F4BVWCIBTLFL2F7HVRQG5LDHNWY2 QTW";
      expect(isValidStellarAddress(invalidAddress)).toBe(false);
    });

    it("should reject addresses with invalid base32 characters (like 0, 1, 8, 9)", () => {
      const invalidAddress = "GBUQWP3BOUZX34ULNQG23RQ6F4BVWCIBTLFL2F7HVRQG5LDHNWY0123";
      expect(isValidStellarAddress(invalidAddress)).toBe(false);
    });
  });
});
