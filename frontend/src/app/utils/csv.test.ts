import { downloadCsv, rowsToCsv } from "./csv";

/**
 * CSV export escaping (issue #2145).
 *
 * `csv.ts` is the only place where user-visible rows leave the app as a
 * spreadsheet, so this suite pins the escaping contract it has to keep:
 *
 *  - RFC 4180 quoting: cells containing `,`, `"`, `\n` or `\r` are wrapped in
 *    double quotes and embedded quotes are doubled;
 *  - spreadsheet injection: cells that start with `=`, `+`, `-`, `@`, a tab or
 *    a carriage return are prefixed with `'`, so a formula or DDE payload stays
 *    inert when the file is opened, while plain signed numbers such as
 *    `-12.5` are still exported as numbers;
 *  - single-cell containment: no value can add a record or a column, so the
 *    shape of the file is fully determined by the header row;
 *  - `downloadCsv` hands the exact UTF-8 payload to the browser and releases the
 *    anchor and the object URL even when the click fails.
 */

/**
 * Minimal RFC 4180 reader. Basic on purpose: it only understands quoting,
 * doubled quotes, commas and LF records, which is enough to prove that escaped
 * cells round-trip and that hostile values cannot leak into a neighbour cell.
 */
const parseCsv = (csv: string): string[][] => {
  const records: string[][] = [];
  let record: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];

    if (quoted) {
      if (char === '"' && csv[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      record.push(cell);
      cell = "";
    } else if (char === "\n") {
      record.push(cell);
      records.push(record);
      record = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (cell !== "" || record.length > 0) {
    record.push(cell);
    records.push(record);
  }

  return records;
};

/**
 * jsdom's `Blob` predates `Blob.text()`, so read the payload through
 * `FileReader`; that also proves the bytes decode back as UTF-8.
 */
const readBlobText = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob, "utf-8");
  });

describe("csv utils", () => {
  describe("rowsToCsv", () => {
    describe("success paths", () => {
      it("returns an empty string when there is nothing to export", () => {
        expect(rowsToCsv([])).toBe("");
        expect(rowsToCsv([], [])).toBe("");
      });

      it("returns only the header line when the export is empty but typed", () => {
        expect(rowsToCsv([], ["date", "amount"])).toBe("date,amount\n");
      });

      it("writes a header row followed by one record per row", () => {
        const csv = rowsToCsv(
          [
            { date: "2026-01-02", amount: 10 },
            { date: "2026-01-03", amount: 2.5 },
          ],
          ["date", "amount"],
        );

        expect(csv).toBe("date,amount\n2026-01-02,10\n2026-01-03,2.5\n");
        expect(parseCsv(csv)).toEqual([
          ["date", "amount"],
          ["2026-01-02", "10"],
          ["2026-01-03", "2.5"],
        ]);
      });

      it("always terminates the last record with a newline", () => {
        expect(rowsToCsv([{ a: "1" }], ["a"])).toBe("a\n1\n");
      });

      it("derives the header row from the union of keys, in first-seen order", () => {
        expect(rowsToCsv([{ b: 1, a: 2 }, { c: 3 }])).toBe("b,a,c\n1,2,\n,,3\n");
      });

      it("respects an explicit header order and ignores extra keys", () => {
        expect(rowsToCsv([{ b: 1, a: 2 }], ["a", "b"])).toBe("a,b\n2,1\n");
        expect(rowsToCsv([{ a: 1, extra: 9 }], ["a"])).toBe("a\n1\n");
      });
    });

    describe("RFC 4180 escaping", () => {
      it.each([
        ["a comma", "hello,world", '"hello,world"'],
        ["a double quote", 'he said "hi"', '"he said ""hi"""'],
        ["a line feed", "line1\nline2", '"line1\nline2"'],
        ["a carriage return", "line1\rline2", '"line1\rline2"'],
        ["CRLF", "line1\r\nline2", '"line1\r\nline2"'],
        ["every special at once", 'a,"b"\r\nc', '"a,""b""\r\nc"'],
      ])("quotes cells containing %s", (_label, value, expected) => {
        const csv = rowsToCsv([{ memo: value }], ["memo"]);

        expect(csv).toBe(`memo\n${expected}\n`);
        expect(parseCsv(csv)[1]).toEqual([value]);
      });

      it("escapes header names with the same rules", () => {
        const csv = rowsToCsv([], ['amount,"net"']);

        expect(csv).toBe('"amount,""net"""\n');
        expect(parseCsv(csv)).toEqual([['amount,"net"']]);
      });

      it("leaves plain cells untouched, including surrounding spaces", () => {
        expect(rowsToCsv([{ a: "  padded  " }], ["a"])).toBe("a\n  padded  \n");
        expect(rowsToCsv([{ a: "" }], ["a"])).toBe("a\n\n");
      });
    });

    describe("formula injection", () => {
      it.each([
        "=SUM(A1:A9)",
        "=1+1",
        "+1+1",
        "-1+1",
        "@SUM(A1:A9)",
        '=HYPERLINK("target-cell","click")',
        "=cmd|' /C calc'!A0",
      ])("prefixes the payload %s with a single quote", (payload) => {
        const records = parseCsv(rowsToCsv([{ memo: payload }], ["memo"]));

        expect(records).toHaveLength(2);
        expect(records[1]).toEqual([`'${payload}`]);
      });

      it("prefixes a formula before quoting it", () => {
        expect(rowsToCsv([{ memo: "=SUM(A1,B1)" }], ["memo"])).toBe('memo\n"\'=SUM(A1,B1)"\n');
      });

      it.each([
        ["a tab", "\t=1+1"],
        ["a carriage return", "\r=1+1"],
        ["a tab followed by a plus", "\t+1"],
      ])("prefixes payloads that start with %s", (_label, payload) => {
        expect(parseCsv(rowsToCsv([{ memo: payload }], ["memo"]))[1]).toEqual([`'${payload}`]);
      });

      it("prefixes a signed value that is not a plain number", () => {
        expect(parseCsv(rowsToCsv([{ memo: "-12,5" }], ["memo"]))[1]).toEqual(["'-12,5"]);
      });

      it.each([
        ["a negative decimal", -12.5, "-12.5"],
        ["a negative integer", -42, "-42"],
        ["a positive string amount", "+3", "+3"],
        ["an exponent", -1e-7, "-1e-7"],
        ["a leading-dot decimal", "-.5", "-.5"],
        ["a large negative amount", -1e21, "-1e+21"],
      ])("keeps %s numeric instead of quoting it as text", (_label, value, expected) => {
        expect(parseCsv(rowsToCsv([{ amount: value }], ["amount"]))[1]).toEqual([expected]);
      });
    });

    describe("Unicode", () => {
      it.each([
        ["accented Latin", "café — naïve"],
        ["CJK", "日本語テキスト"],
        ["Arabic", "تحويل الأموال"],
        ["emoji outside the BMP", "😀🚀💸"],
        ["combining marks", "e\u0301clair"],
        ["a zero-width joiner", "a\u200Db"],
        ["a non-breaking space", "10\u00A0XLM"],
        ["a byte order mark", "\uFEFFheader"],
      ])("round-trips %s untouched", (_label, value) => {
        const csv = rowsToCsv([{ memo: value }], ["memo"]);

        expect(csv).toBe(`memo\n${value}\n`);
        expect(parseCsv(csv)[1]).toEqual([value]);
      });

      it("keeps emoji intact inside a quoted and prefixed cell", () => {
        expect(parseCsv(rowsToCsv([{ memo: "=😀,1+1" }], ["memo"]))[1]).toEqual(["'=😀,1+1"]);
        expect(parseCsv(rowsToCsv([{ memo: "😀,=1+1" }], ["memo"]))[1]).toEqual(["😀,=1+1"]);
      });
    });

    describe("boundaries", () => {
      it("renders null and undefined as empty cells", () => {
        expect(rowsToCsv([{ a: null, b: undefined }], ["a", "b"])).toBe("a,b\n,\n");
      });

      it("renders missing keys as empty cells", () => {
        expect(rowsToCsv([{ a: 1 }, { b: 2 }], ["a", "b"])).toBe("a,b\n1,\n,2\n");
      });

      it("renders booleans and zero", () => {
        expect(rowsToCsv([{ a: true, b: false, c: 0 }], ["a", "b", "c"])).toBe(
          "a,b,c\ntrue,false,0\n",
        );
      });

      it("keeps duplicate headers as separate columns", () => {
        expect(rowsToCsv([{ a: 1 }], ["a", "a"])).toBe("a,a\n1,1\n");
      });

      it("does not mutate the rows it receives", () => {
        const rows = [{ a: 1 }, { a: 2 }];

        rowsToCsv(rows);

        expect(rows).toEqual([{ a: 1 }, { a: 2 }]);
      });

      it("is deterministic for the same input", () => {
        const rows = [{ a: "x,y" }, { a: "z" }];

        expect(rowsToCsv(rows)).toBe(rowsToCsv(rows));
      });

      it("handles 1000 rows without dropping the trailing newline", () => {
        const rows = Array.from({ length: 1000 }, (_, index) => ({ index }));
        const csv = rowsToCsv(rows, ["index"]);
        const records = parseCsv(csv);

        expect(records).toHaveLength(1001);
        expect(records.at(-1)).toEqual(["999"]);
        expect(csv.endsWith("\n")).toBe(true);
      });
    });

    /**
     * `csv.ts` has no authorization surface of its own: the activity, wallet and
     * loan pages decide who may export, and the util only receives rows those
     * pages already loaded. The property that still matters here is that nothing
     * in a row can escape its cell, which is what would let exported data
     * impersonate extra columns or records downstream.
     */
    describe("untrusted input containment", () => {
      it("keeps quotes, commas and CRLF payloads inside one cell and one record", () => {
        const payload = 'x","amount":"999"\r\ninjected,row';
        const records = parseCsv(rowsToCsv([{ memo: payload }], ["memo"]));

        expect(records).toHaveLength(2);
        expect(records[1]).toHaveLength(1);
        expect(records[1]).toEqual([payload]);
      });

      it("keeps a fixed column count for every record", () => {
        const records = parseCsv(
          rowsToCsv([{ memo: 'a,b"c\n\r=1', type: "@cmd" }], ["memo", "type"]),
        );

        expect(records.map((record) => record.length)).toEqual([2, 2]);
      });
    });
  });

  describe("downloadCsv", () => {
    const objectUrl = "blob:jest-object-url";

    let createObjectURL: jest.Mock;
    let revokeObjectURL: jest.Mock;
    let click: jest.SpyInstance;

    beforeEach(() => {
      createObjectURL = jest.fn(() => objectUrl);
      revokeObjectURL = jest.fn();
      // jsdom implements neither object-URL helper, so install them explicitly.
      Reflect.set(URL, "createObjectURL", createObjectURL);
      Reflect.set(URL, "revokeObjectURL", revokeObjectURL);
      click = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    });

    afterEach(() => {
      jest.restoreAllMocks();
      Reflect.deleteProperty(URL, "createObjectURL");
      Reflect.deleteProperty(URL, "revokeObjectURL");
    });

    it("downloads the exact UTF-8 payload and releases the object URL", async () => {
      const csv = rowsToCsv([{ memo: "café, =1+1 — 😀" }], ["memo"]);

      downloadCsv("remitlend-activity-2026-01-02.csv", csv);

      expect(createObjectURL).toHaveBeenCalledTimes(1);
      const blob = createObjectURL.mock.calls[0][0] as Blob;
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe("text/csv;charset=utf-8");

      const anchor = click.mock.contexts[0] as HTMLAnchorElement;
      expect(anchor.getAttribute("href")).toBe(objectUrl);
      expect(anchor.download).toBe("remitlend-activity-2026-01-02.csv");
      expect(document.body.contains(anchor)).toBe(false);

      expect(revokeObjectURL).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledWith(objectUrl);
      await expect(readBlobText(blob)).resolves.toBe(csv);
    });

    it("does not prepend a byte order mark", async () => {
      downloadCsv("export.csv", rowsToCsv([{ memo: "x" }], ["memo"]));

      const blob = createObjectURL.mock.calls[0][0] as Blob;
      await expect(readBlobText(blob)).resolves.toBe("memo\nx\n");
    });

    it("propagates a blob failure without touching the document", () => {
      createObjectURL.mockImplementation(() => {
        throw new Error("object URLs are disabled");
      });
      const createElement = jest.spyOn(document, "createElement");
      const append = jest.spyOn(document.body, "appendChild");

      expect(() => downloadCsv("export.csv", "a\n1\n")).toThrow("object URLs are disabled");
      expect(createElement).not.toHaveBeenCalled();
      expect(append).not.toHaveBeenCalled();
      expect(click).not.toHaveBeenCalled();
      expect(revokeObjectURL).not.toHaveBeenCalled();
    });

    it("detaches the anchor and revokes the URL when the click fails", () => {
      click.mockImplementation(() => {
        throw new Error("download blocked");
      });
      const append = jest.spyOn(document.body, "appendChild");

      expect(() => downloadCsv("export.csv", "a\n1\n")).toThrow("download blocked");

      const anchor = append.mock.calls[0][0] as HTMLAnchorElement;
      expect(anchor).toBeInstanceOf(HTMLAnchorElement);
      expect(document.body.contains(anchor)).toBe(false);
      expect(revokeObjectURL).toHaveBeenCalledWith(objectUrl);
    });

    it("revokes the URL when the anchor cannot be attached", () => {
      jest.spyOn(document.body, "appendChild").mockImplementation(() => {
        throw new Error("body is detached");
      });

      expect(() => downloadCsv("export.csv", "a\n1\n")).toThrow("body is detached");
      expect(click).not.toHaveBeenCalled();
      expect(revokeObjectURL).toHaveBeenCalledWith(objectUrl);
      expect(document.querySelectorAll("a[download]")).toHaveLength(0);
    });
  });
});
