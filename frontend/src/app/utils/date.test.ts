import { formatDate } from "./date";

describe("formatDate", () => {
  const iso = "2026-03-15T13:45:00.000Z";

  it.each([
    ["en-US", "Mar 15, 2026"],
    ["es", "15 mar 2026"],
    ["tl", "Mar 15, 2026"],
  ])("formats dates for %s", (locale, expected) => {
    expect(formatDate(iso, locale)).toBe(expected);
  });
});