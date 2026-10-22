import { maskRecipient, maskAddress, type PiiFieldType } from "./piiMask";

// A high surrogate not followed by a low one, or a low surrogate not preceded
// by a high one.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

const FIELDS: PiiFieldType[] = ["email", "phone", "name"];

const WRONG_TYPES: [string, unknown][] = [
  ["null", null],
  ["undefined", undefined],
  ["zero", 0],
  ["number", 4155551234],
  ["NaN", NaN],
  ["true", true],
  ["false", false],
  ["object", { email: "john@example.com" }],
  ["empty array", []],
  ["array of string", ["john@example.com"]],
  ["symbol", Symbol("pii")],
];

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

    it.each([
      ["Jane_Smith+remit@gmail.com", "J***@g***.com"],
      ["kwame@company.co.uk", "k***@c***.co.uk"],
      ["JOHN.DOE@Example.COM", "J***@E***.COM"],
    ])("should mask %s as %s", (input, expected) => {
      expect(maskRecipient(input, "email")).toBe(expected);
    });

    it.each([
      ["", "***@e***.com"],
      ["a", "a***@e***.com"],
      ["ab", "a***@e***.com"],
      ["abc", "a***@e***.com"],
      ["abcd", "a***@e***.com"],
    ])("should reveal at most one character of a %j local part", (local, expected) => {
      expect(maskRecipient(`${local}@example.com`, "email")).toBe(expected);
    });

    it("should not leak local part length", () => {
      const outputs = [1, 2, 3, 20].map((n) =>
        maskRecipient(`${"a".repeat(n)}@example.com`, "email"),
      );
      expect(new Set(outputs).size).toBe(1);
    });

    it.each([
      ["   ", "***"],
      ["@", "***@***"],
      ["a@", "a***@***"],
      ["a@localhost", "a***@***"],
      ["a@.com", "a***@****.com"],
      ["a@b@c.com", "a***@b***.com"],
      ["first.last@@example.com", "f***@@***.com"],
    ])("should mask malformed email %j as %j", (input, expected) => {
      expect(maskRecipient(input, "email")).toBe(expected);
    });

    it.each([
      ["josé@exämple.com", "j***@e***.com"],
      ["émile@exämple.fr", "é***@e***.fr"],
      ["émile@example.com", "e***@e***.com"],
      ["用户@例子.中国", "用***@例***.中国"],
      ["مستخدم@مثال.com", "م***@م***.com"],
      ["😀smile@example.com", "😀***@e***.com"],
      ["user@😀mail.com", "u***@😀***.com"],
      ["𠮷田@example.jp", "𠮷***@e***.jp"],
      ["👨‍👩‍👧family@example.com", "👨***@e***.com"],
    ])("should mask Unicode email %s as %s without splitting surrogates", (input, expected) => {
      const masked = maskRecipient(input, "email");
      expect(masked).toBe(expected);
      expect(masked).not.toMatch(LONE_SURROGATE);
    });

    it.each([
      ["j***@e***.com", "j***@e***.com"],
      ["u***@m***.example.com", "u***@m***.example.com"],
      ["***", "***"],
      ["***@***", "****@***"],
    ])("should never reveal more when re-masking %j", (masked, expected) => {
      expect(maskRecipient(masked, "email")).toBe(expected);
    });

    it("should be idempotent for its own output", () => {
      const once = maskRecipient("john.doe@example.com", "email");
      expect(maskRecipient(once, "email")).toBe(once);
    });

    it("should not trim surrounding whitespace", () => {
      expect(maskRecipient(" john@example.com ", "email")).toBe(" ***@e***.com ");
    });

    it("should produce a short output for very long input", () => {
      expect(maskRecipient(`${"a".repeat(10_000)}@example.com`, "email")).toBe("a***@e***.com");
    });

    // Follow-up: a one-character local part or domain label still appears in
    // full (e.g. "a@b.com" -> "a***@b***.com"); only its length is hidden.
    it.todo("should not reveal every character of a one-character local part or domain label");
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

    it.each([
      ["+2348012345678", "+xx...****78"],
      ["+44 20 7946 0958", "+xx...****58"],
      ["(415) 555-0199", "+xx...****99"],
    ])("should mask %s as %s", (input, expected) => {
      expect(maskRecipient(input, "phone")).toBe(expected);
    });

    it.each([
      ["1", "****"],
      ["12", "****"],
      ["123", "****"],
      ["1234", "****"],
      ["12345", "+xx...****45"],
      ["123456", "+xx...****56"],
    ])("should mask %j (at/around the 4-character threshold) as %j", (input, expected) => {
      expect(maskRecipient(input, "phone")).toBe(expected);
    });

    it("should never reveal more than the last two characters", () => {
      for (let n = 1; n <= 16; n++) {
        const phone = "9876543210123456".slice(0, n);
        const masked = maskRecipient(phone, "phone");
        expect(masked).not.toBe(phone);
        expect(masked).toBe(n <= 4 ? "****" : `+xx...****${phone.slice(-2)}`);
      }
    });

    it.each([
      ["abcde", "+xx...****de"],
      ["not-a-phone", "+xx...****ne"],
      ["   ", "****"],
      [" +14155551234 ", "+xx...****4 "],
    ])("should mask unvalidated input %j as %j", (input, expected) => {
      expect(maskRecipient(input, "phone")).toBe(expected);
    });

    it.each([
      ["+٢٣٤٨٠١٢٣٤٥٦٧٨", "+xx...****٧٨"],
      ["123😀5", "+xx...****😀5"],
      ["1234😀", "+xx...****4😀"],
      ["😀😀😀😀", "****"],
      ["😀😀😀😀😀", "+xx...****😀😀"],
    ])("should mask Unicode phone %s as %s without splitting surrogates", (input, expected) => {
      const masked = maskRecipient(input, "phone");
      expect(masked).toBe(expected);
      expect(masked).not.toMatch(LONE_SURROGATE);
    });

    it.each(["+xx...****34", "****"])("should be idempotent for masked value %j", (masked) => {
      expect(maskRecipient(masked, "phone")).toBe(masked);
    });

    it("should produce a short output for very long input", () => {
      expect(maskRecipient("9".repeat(10_000), "phone")).toBe("+xx...****99");
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

    it.each([
      ["Ada Lovelace", "A***e"],
      ["mary-jane o'neil", "m***l"],
      ["ALICE", "A***E"],
      ["Ann", "A***n"],
    ])("should mask %s as %s", (input, expected) => {
      expect(maskRecipient(input, "name")).toBe(expected);
    });

    it("should not leak name length", () => {
      const outputs = ["Abz", "Abbz", "A" + "b".repeat(50) + "z"].map((n) =>
        maskRecipient(n, "name"),
      );
      expect(new Set(outputs)).toEqual(new Set(["A***z"]));
    });

    it.each([
      ["José", "J***é"],
      ["Zoë", "Z***ë"],
      ["李小龙", "李***龙"],
      ["محمد", "م***د"],
      ["𠮷野家", "𠮷***家"],
      ["😀", "*"],
      ["Bob😀", "B***😀"],
      ["😀Bob😀", "😀***😀"],
      ["👍🏽Sam", "👍***m"],
      ["👨‍👩‍👧", "👨***👧"],
    ])("should mask Unicode name %s as %s without splitting surrogates", (input, expected) => {
      const masked = maskRecipient(input, "name");
      expect(masked).toBe(expected);
      expect(masked).not.toMatch(LONE_SURROGATE);
    });

    it("should treat a combining mark as its own character", () => {
      // "Jose" + U+0301 COMBINING ACUTE ACCENT (decomposed "José").
      const masked = maskRecipient("José", "name");
      expect(masked).toBe("J***́");
      expect(masked).not.toMatch(LONE_SURROGATE);
    });

    it.each([
      ["J***e", "J***e"],
      ["*", "*"],
      ["***", "*****"],
    ])("should never reveal more when re-masking %j", (masked, expected) => {
      expect(maskRecipient(masked, "name")).toBe(expected);
    });

    it.each([
      ["   ", " *** "],
      [" John ", " *** "],
    ])("should not trim surrounding whitespace in %j", (input, expected) => {
      expect(maskRecipient(input, "name")).toBe(expected);
    });

    it("should produce a short output for very long input", () => {
      expect(maskRecipient("A" + "x".repeat(10_000) + "Z", "name")).toBe("A***Z");
    });

    // Follow-up: a two-character name still appears in full (e.g. "Jo" ->
    // "J***o", "李娜" -> "李***娜"); only its length is hidden.
    it.todo("should not reveal every character of a two-character name");
  });

  describe("error contract", () => {
    describe.each(FIELDS)("%s field", (field) => {
      it.each(WRONG_TYPES)("should return *** without throwing for %s", (_label, value) => {
        expect(() => maskRecipient(value as string, field)).not.toThrow();
        expect(maskRecipient(value as string, field)).toBe("***");
      });
    });

    it.each([["ssn"], [""], [undefined]])(
      "should return *** for unknown field type %j",
      (field) => {
        expect(maskRecipient("john@example.com", field as PiiFieldType)).toBe("***");
      },
    );
  });
});

describe("maskAddress", () => {
  const STELLAR_ACCOUNT = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";
  const STELLAR_CONTRACT = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

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

  it.each([
    [STELLAR_ACCOUNT, "GAAZI4...CWN7"],
    [STELLAR_CONTRACT, "CDLZFC...CYSC"],
    [STELLAR_ACCOUNT.toLowerCase(), "gaazi4...cwn7"],
  ])("should mask %s as %s", (input, expected) => {
    expect(maskAddress(input)).toBe(expected);
  });

  it("should never reveal every character of a short address", () => {
    const source = "ABCDEFGHIJKLMNOPQRST";
    for (let n = 0; n <= source.length; n++) {
      const address = source.slice(0, n);
      const masked = maskAddress(address);
      if (n <= 10) {
        expect(masked).toBe("***");
      } else {
        expect(masked).toBe(`${address.slice(0, 6)}...${address.slice(-4)}`);
        expect(masked.replace("...", "").length).toBeLessThan(n);
      }
    }
  });

  it.each([
    ["ABCDEFGHIJ", "***"],
    ["ABCDEFGHIJK", "ABCDEF...HIJK"],
  ])("should mask %j at the 10-character threshold as %j", (input, expected) => {
    expect(maskAddress(input)).toBe(expected);
  });

  it.each([
    ["😀".repeat(5), "***"],
    ["😀".repeat(11), "😀😀😀😀😀😀...😀😀😀😀"],
    ["ГАБВГДЕЖЗИЙК", "ГАБВГД...ЗИЙК"],
    ["G😀BCDEFGHIJ😀", "G😀BCDE...HIJ😀"],
  ])("should mask Unicode address %s as %s without splitting surrogates", (input, expected) => {
    const masked = maskAddress(input);
    expect(masked).toBe(expected);
    expect(masked).not.toMatch(LONE_SURROGATE);
  });

  it("should be idempotent for its own output", () => {
    const once = maskAddress(STELLAR_ACCOUNT);
    expect(maskAddress(once)).toBe(once);
  });

  it.each([
    ["   ", "***"],
    [` ${STELLAR_ACCOUNT} `, " GAAZI...WN7 "],
  ])("should not trim surrounding whitespace in %j", (input, expected) => {
    expect(maskAddress(input)).toBe(expected);
  });

  it("should produce a short output for very long input", () => {
    expect(maskAddress("G" + "A".repeat(10_000) + "WXYZ")).toBe("GAAAAA...WXYZ");
  });

  it.each(WRONG_TYPES)("should return *** without throwing for %s", (_label, value) => {
    expect(() => maskAddress(value as string)).not.toThrow();
    expect(maskAddress(value as string)).toBe("***");
  });
});
