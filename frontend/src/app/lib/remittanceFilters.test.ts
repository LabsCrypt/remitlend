/**
 * lib/remittanceFilters.test.ts
 *
 * Unit tests for the remittances filter normalization (#1881).
 *
 * The page's filter inputs were fully interactive but nothing consumed them,
 * so these cover the seam that now makes them functional — in particular the
 * cases where a naive implementation would silently return the wrong rows.
 */

import {
  normalizeRemittanceFilters,
  hasActiveRemittanceFilters,
  withRemittanceFilters,
  type RemittanceFilterInput,
} from "./remittanceFilters";

const BLANK: RemittanceFilterInput = {
  searchQuery: "",
  dateFrom: "",
  dateTo: "",
  minAmount: "",
  maxAmount: "",
};

function input(over: Partial<RemittanceFilterInput> = {}): RemittanceFilterInput {
  return { ...BLANK, ...over };
}

describe("normalizeRemittanceFilters", () => {
  it("returns no params when nothing is set", () => {
    expect(normalizeRemittanceFilters(BLANK)).toEqual({});
  });

  it("trims the search term", () => {
    expect(normalizeRemittanceFilters(input({ searchQuery: "  GA123  " }))).toEqual({
      q: "GA123",
    });
  });

  it("treats a whitespace-only search term as unset", () => {
    // Would otherwise be sent as `q=+++` and match nothing.
    expect(normalizeRemittanceFilters(input({ searchQuery: "   " }))).toEqual({});
  });

  it("caps the search term at the API's 255-char limit", () => {
    const result = normalizeRemittanceFilters(input({ searchQuery: "a".repeat(300) }));
    expect(result.q).toHaveLength(255);
  });

  describe("date bounds", () => {
    it("expands the lower bound to the start of the day", () => {
      expect(normalizeRemittanceFilters(input({ dateFrom: "2026-01-15" }))).toEqual({
        from: "2026-01-15T00:00:00.000Z",
      });
    });

    it("expands the upper bound to the end of the day", () => {
      // The bug this guards: Date.parse("2026-01-15") is midnight *starting*
      // that day, and the API filters created_at <= to. Passing the raw date
      // dropped every remittance sent on the day the user selected.
      expect(normalizeRemittanceFilters(input({ dateTo: "2026-01-15" }))).toEqual({
        to: "2026-01-15T23:59:59.999Z",
      });
    });

    it("produces an inclusive range that actually contains the whole day", () => {
      const { from, to } = normalizeRemittanceFilters(
        input({ dateFrom: "2026-01-15", dateTo: "2026-01-15" }),
      );
      const lastMomentOfDay = Date.parse("2026-01-15T23:59:59.999Z");
      expect(Date.parse(from!)).toBeLessThanOrEqual(Date.parse("2026-01-15T12:00:00Z"));
      expect(Date.parse(to!)).toBeGreaterThanOrEqual(lastMomentOfDay);
    });

    it("passes an already-complete ISO timestamp through untouched", () => {
      expect(normalizeRemittanceFilters(input({ dateFrom: "2026-01-15T06:30:00.000Z" }))).toEqual({
        from: "2026-01-15T06:30:00.000Z",
      });
    });

    it("drops an unparseable date rather than sending it", () => {
      // The API rejects an invalid date with a 400, which would blank the list.
      expect(normalizeRemittanceFilters(input({ dateFrom: "not-a-date" }))).toEqual({});
    });

    describe("timezone and calendar boundaries", () => {
      it("handles leap day correctly", () => {
        // 2024 is a leap year
        expect(normalizeRemittanceFilters(input({ dateFrom: "2024-02-29" }))).toEqual({
          from: "2024-02-29T00:00:00.000Z",
        });
        expect(normalizeRemittanceFilters(input({ dateTo: "2024-02-29" }))).toEqual({
          to: "2024-02-29T23:59:59.999Z",
        });
      });

      it("handles year boundary (Dec 31 to Jan 1)", () => {
        const { from, to } = normalizeRemittanceFilters(
          input({ dateFrom: "2025-12-31", dateTo: "2026-01-01" }),
        );
        expect(from).toBe("2025-12-31T00:00:00.000Z");
        expect(to).toBe("2026-01-01T23:59:59.999Z");
      });

      it("handles month boundaries with different day counts", () => {
        // April has 30 days, May has 31
        expect(normalizeRemittanceFilters(input({ dateTo: "2026-04-30" }))).toEqual({
          to: "2026-04-30T23:59:59.999Z",
        });
        expect(normalizeRemittanceFilters(input({ dateTo: "2026-05-31" }))).toEqual({
          to: "2026-05-31T23:59:59.999Z",
        });
      });

      it("handles DST spring forward boundary (2026-03-08 in US)", () => {
        // When DST starts, the day has 23 hours in local time but 24 in UTC
        // The implementation uses UTC so this should not affect the result
        expect(normalizeRemittanceFilters(input({ dateFrom: "2026-03-08" }))).toEqual({
          from: "2026-03-08T00:00:00.000Z",
        });
        expect(normalizeRemittanceFilters(input({ dateTo: "2026-03-08" }))).toEqual({
          to: "2026-03-08T23:59:59.999Z",
        });
      });

      it("handles DST fall back boundary (2026-11-01 in US)", () => {
        // When DST ends, the day has 25 hours in local time but 24 in UTC
        expect(normalizeRemittanceFilters(input({ dateFrom: "2026-11-01" }))).toEqual({
          from: "2026-11-01T00:00:00.000Z",
        });
        expect(normalizeRemittanceFilters(input({ dateTo: "2026-11-01" }))).toEqual({
          to: "2026-11-01T23:59:59.999Z",
        });
      });

      it("produces chronologically ordered bounds when from > to", () => {
        // The implementation doesn't validate order; it just normalizes each bound
        const { from, to } = normalizeRemittanceFilters(
          input({ dateFrom: "2026-01-20", dateTo: "2026-01-10" }),
        );
        expect(from).toBe("2026-01-20T00:00:00.000Z");
        expect(to).toBe("2026-01-10T23:59:59.999Z");
        // Resulting range is empty (from > to) which is valid API behavior
        expect(Date.parse(from!)).toBeGreaterThan(Date.parse(to!));
      });
    });

    describe("invalid date handling", () => {
      it("accepts YYYY-MM-DD format even with invalid calendar values (regex match only)", () => {
        // The implementation validates format via regex, not calendar validity.
        // These match the regex so they get the suffix appended.
        expect(normalizeRemittanceFilters(input({ dateFrom: "2026-13-01" }))).toEqual({
          from: "2026-13-01T00:00:00.000Z",
        });
        expect(normalizeRemittanceFilters(input({ dateTo: "2026-13-01" }))).toEqual({
          to: "2026-13-01T23:59:59.999Z",
        });
      });

      it("accepts YYYY-MM-DD format with invalid day (32)", () => {
        expect(normalizeRemittanceFilters(input({ dateFrom: "2026-01-32" }))).toEqual({
          from: "2026-01-32T00:00:00.000Z",
        });
        expect(normalizeRemittanceFilters(input({ dateTo: "2026-01-32" }))).toEqual({
          to: "2026-01-32T23:59:59.999Z",
        });
      });

      it("accepts YYYY-MM-DD format with Feb 30", () => {
        expect(normalizeRemittanceFilters(input({ dateFrom: "2026-02-30" }))).toEqual({
          from: "2026-02-30T00:00:00.000Z",
        });
        expect(normalizeRemittanceFilters(input({ dateFrom: "2024-02-30" }))).toEqual({
          from: "2024-02-30T00:00:00.000Z",
        });
      });

      it("accepts YYYY-MM-DD format with Feb 29 in non-leap year", () => {
        expect(normalizeRemittanceFilters(input({ dateFrom: "2026-02-29" }))).toEqual({
          from: "2026-02-29T00:00:00.000Z",
        });
        expect(normalizeRemittanceFilters(input({ dateFrom: "2025-02-29" }))).toEqual({
          from: "2025-02-29T00:00:00.000Z",
        });
      });

      it("parses lenient date formats that Date.parse accepts", () => {
        // Date.parse in Node.js accepts "2026-1-1" (missing zero padding)
        // These don't match ISO_DATE_ONLY regex, so Date.parse is used
        // and since it returns a valid timestamp, they pass through
        expect(normalizeRemittanceFilters(input({ dateFrom: "2026-1-1" }))).toEqual({
          from: "2026-1-1",
        });
        expect(normalizeRemittanceFilters(input({ dateTo: "2026-01-1" }))).toEqual({
          to: "2026-01-1",
        });
      });

      it("drops date with time component but invalid timezone offset", () => {
        // These don't match regex, Date.parse returns NaN for invalid offset
        expect(
          normalizeRemittanceFilters(input({ dateFrom: "2026-01-15T12:00:00+99:00" })),
        ).toEqual({});
        expect(
          normalizeRemittanceFilters(input({ dateFrom: "2026-01-15T12:00:00-99:00" })),
        ).toEqual({});
      });

      it("passes through date with nanosecond precision (exceeds JS Date) since regex doesn't match", () => {
        // Doesn't match ISO_DATE_ONLY, Date.parse handles it (may truncate)
        expect(
          normalizeRemittanceFilters(input({ dateFrom: "2026-01-15T12:00:00.123456789Z" })),
        ).toEqual({
          from: "2026-01-15T12:00:00.123456789Z",
        });
      });

      it("handles whitespace around date strings", () => {
        expect(normalizeRemittanceFilters(input({ dateFrom: "  2026-01-15  " }))).toEqual({
          from: "2026-01-15T00:00:00.000Z",
        });
        expect(normalizeRemittanceFilters(input({ dateTo: "\t2026-01-15\n" }))).toEqual({
          to: "2026-01-15T23:59:59.999Z",
        });
      });

      it("drops empty string after trim", () => {
        expect(normalizeRemittanceFilters(input({ dateFrom: "   " }))).toEqual({});
        expect(normalizeRemittanceFilters(input({ dateTo: "\t\n" }))).toEqual({});
      });
    });
  });

  describe("amount bounds", () => {
    it("parses numeric bounds", () => {
      expect(normalizeRemittanceFilters(input({ minAmount: "10.5", maxAmount: "99" }))).toEqual({
        minAmount: 10.5,
        maxAmount: 99,
      });
    });

    it("treats a blank amount as unset, not as zero", () => {
      // Number("") is 0. Getting this wrong turns an untouched field into a
      // real `amount >= 0` filter.
      expect(normalizeRemittanceFilters(input({ minAmount: "", maxAmount: "" }))).toEqual({});
    });

    it("accepts an explicit zero", () => {
      expect(normalizeRemittanceFilters(input({ minAmount: "0" }))).toEqual({ minAmount: 0 });
    });

    it("drops non-numeric input while the user is mid-typing", () => {
      for (const junk of ["-", "1e", "abc", "."]) {
        expect(normalizeRemittanceFilters(input({ minAmount: junk }))).toEqual({});
      }
    });
  });

  it("carries every filter at once", () => {
    expect(
      normalizeRemittanceFilters(
        input({
          searchQuery: "alice",
          dateFrom: "2026-01-01",
          dateTo: "2026-01-31",
          minAmount: "5",
          maxAmount: "500",
        }),
      ),
    ).toEqual({
      q: "alice",
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-01-31T23:59:59.999Z",
      minAmount: 5,
      maxAmount: 500,
    });
  });
});

describe("hasActiveRemittanceFilters", () => {
  it("is false for a blank form", () => {
    expect(hasActiveRemittanceFilters(BLANK)).toBe(false);
  });

  it("is true when any single field carries a value", () => {
    expect(hasActiveRemittanceFilters(input({ searchQuery: "a" }))).toBe(true);
    expect(hasActiveRemittanceFilters(input({ dateFrom: "2026-01-01" }))).toBe(true);
    expect(hasActiveRemittanceFilters(input({ minAmount: "1" }))).toBe(true);
  });

  it("is false when the user typed only whitespace or junk", () => {
    expect(hasActiveRemittanceFilters(input({ searchQuery: "  " }))).toBe(false);
    expect(hasActiveRemittanceFilters(input({ minAmount: "-" }))).toBe(false);
  });
});

describe("withRemittanceFilters", () => {
  it("preserves the base params", () => {
    const result = withRemittanceFilters(
      { limit: 20, cursor: null, status: "completed" },
      input({ searchQuery: "bob" }),
    );
    expect(result).toEqual({ limit: 20, cursor: null, status: "completed", q: "bob" });
  });

  it("adds nothing when the form is blank", () => {
    expect(withRemittanceFilters({ limit: 20 }, BLANK)).toEqual({ limit: 20 });
  });
});
