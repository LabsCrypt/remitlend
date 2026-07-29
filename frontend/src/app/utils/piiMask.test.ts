import { maskRecipient, maskAddress } from "./piiMask";

describe("maskRecipient", () => {
  describe("email masking", () => {
    it("should mask standard email", () => {
      expect(maskRecipient("john.doe@example.com", "email")).toBe("j***@e***.com");
    });

    it("should mask short email", () => {
      expect(maskRecipient("a@b.com", "email")).toBe("a***@b***.com");
    });

    it("should mask email with subdomain", () => {
      expect(maskRecipient("user@mail.example.com", "email")).toBe("u***@m***.example.com");
    });

    it("should return *** for invalid email", () => {
      expect(maskRecipient("noat", "email")).toBe("***");
    });

    it("should return *** for empty string", () => {
      expect(maskRecipient("", "email")).toBe("***");
    });
  });

  describe("phone masking", () => {
    it("should mask standard phone", () => {
      expect(maskRecipient("+14155551234", "phone")).toBe("+xx...****34");
    });

    it("should mask short phone", () => {
      expect(maskRecipient("123", "phone")).toBe("****");
    });

    it("should mask exactly 4 digit phone", () => {
      expect(maskRecipient("1234", "phone")).toBe("****");
    });
  });

  describe("name masking", () => {
    it("should mask full name", () => {
      expect(maskRecipient("John Doe", "name")).toBe("J***e");
    });

    it("should mask two char name", () => {
      expect(maskRecipient("Jo", "name")).toBe("J***o");
    });

    it("should mask single char name", () => {
      expect(maskRecipient("X", "name")).toBe("*");
    });

    it("should return *** for empty name", () => {
      expect(maskRecipient("", "name")).toBe("***");
    });
  });
});

describe("maskAddress", () => {
  it("should mask stellar address", () => {
    const addr = "GABC1234567890DEF";
    expect(maskAddress(addr)).toBe("GABC12...0DEF");
  });

  it("should return *** for short address", () => {
    expect(maskAddress("short")).toBe("***");
  });

  it("should return *** for empty address", () => {
    expect(maskAddress("")).toBe("***");
  });
});
