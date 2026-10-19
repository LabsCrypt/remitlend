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
