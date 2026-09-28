import { rowsToCsv } from "./csv";

describe("csv utils", () => {
  describe("rowsToCsv", () => {
    it("returns empty string for empty rows with no headers", () => {
      expect(rowsToCsv([])).toBe("");
    });

    it("returns header line for empty rows with headers", () => {
      expect(rowsToCsv([], ["a", "b"])).toBe("a,b\n");
    });

    it("quotes values containing commas", () => {
      expect(rowsToCsv([{ a: "hello,world" }], ["a"])).toBe('a\n"hello,world"\n');
    });

    it("doubles embedded quotes and wraps value in quotes", () => {
      expect(rowsToCsv([{ a: 'he said "hi"' }], ["a"])).toBe('a\n"he said ""hi"""\n');
    });

    it("quotes values containing newlines", () => {
      expect(rowsToCsv([{ a: "line1\nline2" }], ["a"])).toBe('a\n"line1\nline2"\n');
    });

    it("derives headers when omitted (union of keys)", () => {
      expect(rowsToCsv([{ a: 1 }, { b: 2 }]).startsWith("a,b\n")).toBe(true);
    });

    it("renders null/undefined as empty string", () => {
      expect(rowsToCsv([{ a: null, b: undefined }], ["a", "b"])).toBe("a,b\n,\n");
    });

    it("neutralizes values beginning with formula injection characters (=, +, -, @)", () => {
      expect(rowsToCsv([{ a: "=1+1" }], ["a"])).toBe("a\n'=1+1\n");
      expect(rowsToCsv([{ a: "+100" }], ["a"])).toBe("a\n'+100\n");
      expect(rowsToCsv([{ a: "-50" }], ["a"])).toBe("a\n'-50\n");
      expect(rowsToCsv([{ a: "@sum" }], ["a"])).toBe("a\n'@sum\n");
    });

    it("neutralizes formula injection characters while preserving CSV quoting for commas and quotes", () => {
      expect(rowsToCsv([{ a: '=HYPERLINK("http://evil.com","click")' }], ["a"])).toBe(
        'a\n"\'=HYPERLINK(""http://evil.com"",""click"")"\n',
      );
    });
  });
});
