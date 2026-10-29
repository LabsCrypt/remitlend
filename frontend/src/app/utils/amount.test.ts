import {
  formatAmountOnBlur,
  formatTypedAmount,
  fromStroops,
  getAssetDecimals,
  getPrecisionError,
  hasInvalidPrecision,
  parseAmount,
  sanitizeAmountInput,
  toStroops,
} from "./amount";

// `tsc` rejects BigInt literal syntax (`0n`) below ES2020, and this
// frontend's tsconfig.json targets ES2017.
const b = (n: number): bigint => BigInt(n);

describe("amount utils", () => {
  describe("getAssetDecimals", () => {
    it("returns known asset decimals", () => {
      expect(getAssetDecimals("XLM")).toBe(7);
      expect(getAssetDecimals("USDC")).toBe(2);
      expect(getAssetDecimals("EURC")).toBe(2);
      expect(getAssetDecimals("PHP")).toBe(2);
    });

    it("falls back for unknown assets", () => {
      expect(getAssetDecimals("UNKNOWN")).toBe(7);
    });
  });

  describe("toStroops", () => {
    it("converts whole and fractional amounts", () => {
      expect(toStroops("1", 7)?.toString()).toBe("10000000");
      expect(toStroops("1.5", 7)?.toString()).toBe("15000000");
      expect(toStroops("0.01", 2)?.toString()).toBe("1");
      expect(toStroops("12.34", 2)?.toString()).toBe("1234");
    });

    it("returns null when precision exceeds decimals", () => {
      expect(toStroops("1.234", 2)).toBeNull();
      expect(toStroops("0.00000001", 7)).toBeNull();
    });

    it("handles very large values correctly", () => {
      // Max safe integer for 7 decimals
      expect(toStroops("99999999999999.9999999", 7)?.toString()).toBe("999999999999999999999");
      // Large value for 2 decimals (USDC)
      expect(toStroops("999999999999999.99", 2)?.toString()).toBe("99999999999999999");
    });

    it("handles tiny values at boundary", () => {
      // Smallest non-zero for 7 decimals
      expect(toStroops("0.0000001", 7)?.toString()).toBe("1");
      // Smallest non-zero for 2 decimals
      expect(toStroops("0.01", 2)?.toString()).toBe("1");
    });

    it("handles unsupported decimal precisions", () => {
      // 3 decimals - not a standard asset but should work
      expect(toStroops("1.123", 3)?.toString()).toBe("1123");
      expect(toStroops("10.500", 3)?.toString()).toBe("10500");
      // 4 decimals
      expect(toStroops("1.1234", 4)?.toString()).toBe("11234");
      // 6 decimals
      expect(toStroops("1.123456", 6)?.toString()).toBe("1123456");
      // 8 decimals (more than XLM)
      expect(toStroops("1.12345678", 8)?.toString()).toBe("112345678");
    });

    it("returns null for unsupported decimals when precision exceeds", () => {
      expect(toStroops("1.1234", 3)).toBeNull(); // 4 decimals > 3
      expect(toStroops("1.12345", 3)).toBeNull(); // 5 decimals > 3
      expect(toStroops("1.123456789", 8)).toBeNull(); // 9 decimals > 8
    });

    it("handles zero and empty values", () => {
      expect(toStroops("0", 7)?.toString()).toBe("0");
      expect(toStroops("0.0", 7)?.toString()).toBe("0");
      expect(toStroops("0.0000000", 7)?.toString()).toBe("0");
      expect(toStroops("", 7)).toBeNull();
    });

    it("handles values with leading/trailing zeros", () => {
      expect(toStroops("0001.500", 7)?.toString()).toBe("15000000");
      expect(toStroops("1.5000000", 7)?.toString()).toBe("15000000");
      expect(toStroops("0000.01", 2)?.toString()).toBe("1");
    });

    it("handles trailing zeros in fraction (within precision limit)", () => {
      // "12.34" has 2 decimals, "12.3400" has 4 decimals which exceeds 2
      expect(toStroops("12.34", 2)?.toString()).toBe("1234");
      // This exceeds precision limit (4 decimals > 2)
      expect(toStroops("12.3400", 2)).toBeNull();
    });
  });

  describe("fromStroops", () => {
    it("converts stroops back to string for standard 7 decimals", () => {
      expect(fromStroops(b(10000000), 7)).toBe("1.0000000");
      expect(fromStroops(b(15000000), 7)).toBe("1.5000000");
      expect(fromStroops(b(1), 7)).toBe("0.0000001");
      expect(fromStroops(b(0), 7)).toBe("0.0000000");
    });

    it("handles negative amounts", () => {
      expect(fromStroops(b(-10000000), 7)).toBe("-1.0000000");
      expect(fromStroops(b(-1), 7)).toBe("-0.0000001");
    });

    it("handles various decimal precisions", () => {
      expect(fromStroops(b(100), 2)).toBe("1.00");
      expect(fromStroops(b(1234), 2)).toBe("12.34");
      expect(fromStroops(b(1), 2)).toBe("0.01");
      expect(fromStroops(b(1123), 3)).toBe("1.123");
      expect(fromStroops(b(11234), 4)).toBe("1.1234");
      expect(fromStroops(b(1123456), 6)).toBe("1.123456");
      expect(fromStroops(b(112345678), 8)).toBe("1.12345678");
    });

    it("handles very large stroop values", () => {
      // Use string to create BigInt to avoid precision loss
      expect(fromStroops(BigInt("999999999999999999999"), 7)).toBe("99999999999999.9999999");
      expect(fromStroops(BigInt("99999999999999999"), 2)).toBe("999999999999999.99");
    });

    it("handles tiny stroop values", () => {
      expect(fromStroops(b(1), 7)).toBe("0.0000001");
      expect(fromStroops(b(1), 2)).toBe("0.01");
      expect(fromStroops(b(1), 3)).toBe("0.001");
    });

    it("handles zero correctly", () => {
      expect(fromStroops(b(0), 7)).toBe("0.0000000");
      expect(fromStroops(b(0), 2)).toBe("0.00");
      expect(fromStroops(b(0), 3)).toBe("0.000");
    });
  });

  describe("formatTypedAmount", () => {
    it("formats standard amounts", () => {
      expect(formatTypedAmount("1", 7)).toBe("1");
      expect(formatTypedAmount("1.5", 7)).toBe("1.5");
      expect(formatTypedAmount("1.2345678", 7)).toBe("1.2345678");
    });

    it("handles very large values (limited by JS Number precision)", () => {
      // JavaScript Number loses precision beyond MAX_SAFE_INTEGER
      // Number.parseFloat("99999999999999.9999999") becomes 100000000000000
      const result = formatTypedAmount("99999999999999.9999999", 7);
      expect(result).toBe("100,000,000,000,000");
    });

    it("handles tiny values", () => {
      expect(formatTypedAmount("0.0000001", 7)).toBe("0.0000001");
      expect(formatTypedAmount("0.01", 2)).toBe("0.01");
      expect(formatTypedAmount("0.001", 3)).toBe("0.001");
    });

    it("handles unsupported decimals", () => {
      expect(formatTypedAmount("1.123", 3)).toBe("1.123");
      expect(formatTypedAmount("1.1234", 4)).toBe("1.1234");
      expect(formatTypedAmount("1.12345", 5)).toBe("1.12345");
      expect(formatTypedAmount("1.123456", 6)).toBe("1.123456");
      expect(formatTypedAmount("1.12345678", 8)).toBe("1.12345678");
    });

    it("returns null for empty or NaN input", () => {
      expect(formatTypedAmount("", 7)).toBeNull();
      expect(formatTypedAmount("abc", 7)).toBeNull();
    });

    it("handles multiple decimal points (parseFloat stops at second)", () => {
      // parseFloat("1.2.3") returns 1.2
      expect(formatTypedAmount("1.2.3", 7)).toBe("1.2");
    });

    it("handles Infinity (parseFloat returns Infinity)", () => {
      expect(formatTypedAmount("Infinity", 7)).toBe("∞");
      expect(formatTypedAmount("-Infinity", 7)).toBe("-∞");
    });

    it("handles locale formatting", () => {
      expect(formatTypedAmount("1234.56", 2, "de-DE")).toBe("1.234,56");
      expect(formatTypedAmount("1234.56", 2, "fr-FR")).toBe("1\u202F234,56");
    });
  });

  describe("parseAmount", () => {
    it("parses standard amounts", () => {
      expect(parseAmount("1")).toBe(1);
      expect(parseAmount("1.5")).toBe(1.5);
      expect(parseAmount("0.01")).toBe(0.01);
    });

    it("handles very large values", () => {
      // Limited by JS Number precision
      expect(parseAmount("99999999999999.9999999")).toBe(99999999999999.9999999);
      expect(parseAmount("12345678901234.56")).toBe(12345678901234.56);
    });

    it("handles tiny values", () => {
      expect(parseAmount("0.0000001")).toBe(0.0000001);
      expect(parseAmount("0.01")).toBe(0.01);
      expect(parseAmount("0.001")).toBe(0.001);
    });

    it("returns NaN for invalid input", () => {
      expect(Number.isNaN(parseAmount("abc"))).toBe(true);
      expect(Number.isNaN(parseAmount(""))).toBe(true);
      // parseFloat stops at second dot
      expect(parseAmount("1.2.3")).toBe(1.2);
    });
  });

  describe("hasInvalidPrecision / getPrecisionError", () => {
    it("treats values at the limit as valid", () => {
      expect(hasInvalidPrecision("1.12", 2)).toBe(false);
      expect(getPrecisionError("1.12", "USDC")).toBeNull();
    });

    it("flags values over the limit and returns error text", () => {
      expect(hasInvalidPrecision("1.123", 2)).toBe(true);
      expect(getPrecisionError("1.123", "USDC")).toBe("USDC supports at most 2 decimal places.");
    });

    it("handles various decimal limits correctly", () => {
      expect(hasInvalidPrecision("1.1234", 3)).toBe(true); // 4 decimals > 3
      expect(hasInvalidPrecision("1.12345", 3)).toBe(true); // 5 decimals > 3
      // "1.123456" has 6 decimal digits, 6 > 5 so invalid
      expect(hasInvalidPrecision("1.123456", 5)).toBe(true);
      expect(hasInvalidPrecision("1.1234567", 5)).toBe(true);
    });

    it("handles unsupported decimal precisions", () => {
      // 3 decimals
      expect(hasInvalidPrecision("1.123", 3)).toBe(false);
      expect(hasInvalidPrecision("1.1234", 3)).toBe(true);
      expect(getPrecisionError("1.1234", "CUSTOM", 3)).toBe(
        "CUSTOM supports at most 3 decimal places.",
      );

      // 4 decimals
      expect(hasInvalidPrecision("1.1234", 4)).toBe(false);
      expect(hasInvalidPrecision("1.12345", 4)).toBe(true);

      // 6 decimals
      expect(hasInvalidPrecision("1.123456", 6)).toBe(false);
      expect(hasInvalidPrecision("1.1234567", 6)).toBe(true);

      // 8 decimals (more than XLM)
      expect(hasInvalidPrecision("1.12345678", 8)).toBe(false);
      expect(hasInvalidPrecision("1.123456789", 8)).toBe(true);
    });

    it("handles values without decimals", () => {
      expect(hasInvalidPrecision("100", 2)).toBe(false);
      expect(hasInvalidPrecision("100", 7)).toBe(false);
      expect(getPrecisionError("100", "USDC")).toBeNull();
    });

    it("handles edge case: only decimal point", () => {
      expect(hasInvalidPrecision(".", 2)).toBe(false);
      expect(hasInvalidPrecision(".1", 2)).toBe(false);
      expect(hasInvalidPrecision(".12", 2)).toBe(false);
      expect(hasInvalidPrecision(".123", 2)).toBe(true);
    });
  });

  describe("sanitizeAmountInput", () => {
    it("strips non-numeric and collapses multiple dots", () => {
      expect(sanitizeAmountInput("$1,234.56")).toBe("1234.56");
      expect(sanitizeAmountInput("1.2.3")).toBe("1.23");
      expect(sanitizeAmountInput("..1..2..3..")).toBe(".123");
    });

    it("handles various edge cases", () => {
      expect(sanitizeAmountInput("")).toBe("");
      expect(sanitizeAmountInput("abc")).toBe("");
      expect(sanitizeAmountInput("123")).toBe("123");
      expect(sanitizeAmountInput("123.456")).toBe("123.456");
      expect(sanitizeAmountInput("...123")).toBe(".123");
      expect(sanitizeAmountInput("123...")).toBe("123.");
      expect(sanitizeAmountInput("...1...2...3...")).toBe(".123");
    });

    it("handles very long inputs", () => {
      const longInput = "1".repeat(1000) + "." + "2".repeat(1000);
      const result = sanitizeAmountInput(longInput);
      expect(result.length).toBeLessThanOrEqual(longInput.length);
      expect(result.split(".").length).toBe(2);
    });
  });

  describe("formatAmountOnBlur", () => {
    it("formats standard amounts with asset decimals", () => {
      expect(formatAmountOnBlur("1", "XLM")).toBe("1.0000000");
      expect(formatAmountOnBlur("1.5", "XLM")).toBe("1.5000000");
      expect(formatAmountOnBlur("12.34", "USDC")).toBe("12.34");
      expect(formatAmountOnBlur("12.345", "USDC")).toBe("12.35"); // rounds
    });

    it("handles very large values (limited by JS Number precision)", () => {
      // JavaScript Number loses precision beyond MAX_SAFE_INTEGER
      const result = formatAmountOnBlur("99999999999999.9999999", "XLM");
      expect(result).toBe("100000000000000.0000000");
    });

    it("handles tiny values", () => {
      expect(formatAmountOnBlur("0.0000001", "XLM")).toBe("0.0000001");
      expect(formatAmountOnBlur("0.01", "USDC")).toBe("0.01");
    });

    it("handles unsupported decimals via asset (falls back to 7)", () => {
      // Test with a hypothetical 3-decimal asset
      expect(formatAmountOnBlur("1.123", "CUSTOM")).toBe("1.1230000"); // falls back to 7
    });

    it("returns empty string for invalid input", () => {
      expect(formatAmountOnBlur("", "XLM")).toBe("");
      expect(formatAmountOnBlur("abc", "XLM")).toBe("");
      expect(formatAmountOnBlur("NaN", "XLM")).toBe("");
    });
  });

  describe("round-trip: toStroops -> fromStroops", () => {
    it("round-trips standard amounts", () => {
      // fromStroops always outputs with the exact number of decimal places
      // So we test that the numeric value is preserved
      const testCases = [
        { input: "1.5", expected: "1.5000000" },
        { input: "1234567.1234567", expected: "1234567.1234567" },
        { input: "0.0000001", expected: "0.0000001" },
        { input: "99999999999999.9999999", expected: "99999999999999.9999999" },
      ];
      for (const { input, expected } of testCases) {
        const stroops = toStroops(input, 7);
        expect(stroops).not.toBeNull();
        const back = fromStroops(stroops!, 7);
        expect(back).toBe(expected);
      }
    });

    it("round-trips 2-decimal amounts (USDC)", () => {
      const amounts = ["12.34", "0.01", "999999999999999.99"];
      for (const amount of amounts) {
        const stroops = toStroops(amount, 2);
        expect(stroops).not.toBeNull();
        const back = fromStroops(stroops!, 2);
        // fromStroops always outputs with full decimal places
        // e.g., "1" becomes "1.00", so we test amounts that have fractional parts
        expect(back).toBe(amount);
      }
    });

    it("round-trips whole numbers (shows fixed decimal places)", () => {
      // fromStroops always outputs with the specified decimal places
      expect(fromStroops(toStroops("1", 7)!, 7)).toBe("1.0000000");
      expect(fromStroops(toStroops("1", 2)!, 2)).toBe("1.00");
    });

    it("round-trips unsupported decimal precisions", () => {
      const testCases = [
        { amount: "1.123", decimals: 3 },
        { amount: "1.1234", decimals: 4 },
        { amount: "1.12345", decimals: 5 },
        { amount: "1.123456", decimals: 6 },
        { amount: "1.12345678", decimals: 8 },
        { amount: "12345.678901", decimals: 6 },
        { amount: "0.001", decimals: 3 },
        { amount: "0.0001", decimals: 4 },
      ];
      for (const { amount, decimals } of testCases) {
        const stroops = toStroops(amount, decimals);
        expect(stroops).not.toBeNull();
        const back = fromStroops(stroops!, decimals);
        expect(back).toBe(amount);
      }
    });
  });

  describe("boundary and edge cases", () => {
    it("handles maximum safe integer boundaries", () => {
      // Number.MAX_SAFE_INTEGER = 9007199254740991
      // With 7 decimals, max safe value is 9007199254740991 / 1e7 = 900719925.4740991
      const maxSafe = "900719925.4740991";
      const stroops = toStroops(maxSafe, 7);
      expect(stroops).not.toBeNull();
      expect(fromStroops(stroops!, 7)).toBe(maxSafe);
    });

    it("handles values beyond Number.MAX_SAFE_INTEGER via BigInt", () => {
      // Values that exceed Number.MAX_SAFE_INTEGER but are within BigInt range
      const largeAmount = "999999999999999999.9999999";
      const stroops = toStroops(largeAmount, 7);
      expect(stroops).not.toBeNull();
      expect(fromStroops(stroops!, 7)).toBe(largeAmount);
    });

    it("handles scientific notation input gracefully", () => {
      // Scientific notation should be handled by parseAmount
      expect(parseAmount("1e6")).toBe(1000000);
      expect(parseAmount("1.5e2")).toBe(150);
      // But toStroops should reject it due to invalid precision
      expect(toStroops("1e6", 7)).toBeNull();
      expect(toStroops("1.5e2", 7)).toBeNull();
    });

    it("handles negative amounts correctly", () => {
      expect(toStroops("-1", 7)?.toString()).toBe("-10000000");
      expect(toStroops("-1.5", 7)?.toString()).toBe("-15000000");
      expect(fromStroops(b(-10000000), 7)).toBe("-1.0000000");
      expect(fromStroops(b(-15000000), 7)).toBe("-1.5000000");
    });

    it("handles values with many leading zeros", () => {
      expect(toStroops("0000001.5000000", 7)?.toString()).toBe("15000000");
      expect(fromStroops(b(15000000), 7)).toBe("1.5000000");
    });
  });
});
