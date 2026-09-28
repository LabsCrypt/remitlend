import { formatCurrency, formatDate, getDaysUntilDeadline } from "./loanFormatters";

describe("loanFormatters", () => {
  describe("formatCurrency", () => {
    it("formats standard USD currency amounts with two decimal places", () => {
      expect(formatCurrency(100)).toBe("$100.00");
      expect(formatCurrency(1234.56)).toBe("$1,234.56");
      expect(formatCurrency(0)).toBe("$0.00");
    });

    it("formats fractional cents correctly", () => {
      expect(formatCurrency(0.5)).toBe("$0.50");
      expect(formatCurrency(1000000)).toBe("$1,000,000.00");
    });
  });

  describe("formatDate", () => {
    it("formats ISO date string into readable US date", () => {
      const formatted = formatDate("2026-10-15T12:00:00Z");
      expect(formatted).toContain("Oct");
      expect(formatted).toContain("15");
      expect(formatted).toContain("2026");
    });
  });

  describe("getDaysUntilDeadline", () => {
    const fixedNow = new Date("2026-09-28T12:00:00Z").getTime();

    it("returns positive days for deadlines in the future", () => {
      // 1 hour in the future -> 1 day remaining (rounded up)
      const oneHourFuture = new Date(fixedNow + 1 * 60 * 60 * 1000).toISOString();
      expect(getDaysUntilDeadline(oneHourFuture, fixedNow)).toBe(1);

      // 23 hours in the future -> 1 day remaining
      const twentyThreeHoursFuture = new Date(fixedNow + 23 * 60 * 60 * 1000).toISOString();
      expect(getDaysUntilDeadline(twentyThreeHoursFuture, fixedNow)).toBe(1);

      // 25 hours in the future -> 2 days remaining
      const twentyFiveHoursFuture = new Date(fixedNow + 25 * 60 * 60 * 1000).toISOString();
      expect(getDaysUntilDeadline(twentyFiveHoursFuture, fixedNow)).toBe(2);

      // 7 days in the future
      const sevenDaysFuture = new Date(fixedNow + 7 * 24 * 60 * 60 * 1000).toISOString();
      expect(getDaysUntilDeadline(sevenDaysFuture, fixedNow)).toBe(7);
    });

    it("returns 0 when deadline is exactly now", () => {
      const exactlyNow = new Date(fixedNow).toISOString();
      expect(getDaysUntilDeadline(exactlyNow, fixedNow)).toBe(0);
    });

    it("returns negative days for deadlines overdue by less than 24 hours (closes #1887)", () => {
      // 1 minute in the past
      const oneMinutePast = new Date(fixedNow - 1 * 60 * 1000).toISOString();
      const daysUntil1m = getDaysUntilDeadline(oneMinutePast, fixedNow);
      expect(daysUntil1m).toBe(-1);
      expect(daysUntil1m < 0).toBe(true);

      // 5 hours in the past
      const fiveHoursPast = new Date(fixedNow - 5 * 60 * 60 * 1000).toISOString();
      const daysUntil5h = getDaysUntilDeadline(fiveHoursPast, fixedNow);
      expect(daysUntil5h).toBe(-1);
      expect(daysUntil5h < 0).toBe(true);

      // 12 hours in the past
      const twelveHoursPast = new Date(fixedNow - 12 * 60 * 60 * 1000).toISOString();
      const daysUntil12h = getDaysUntilDeadline(twelveHoursPast, fixedNow);
      expect(daysUntil12h).toBe(-1);
      expect(daysUntil12h < 0).toBe(true);

      // 23 hours in the past
      const twentyThreeHoursPast = new Date(fixedNow - 23 * 60 * 60 * 1000).toISOString();
      const daysUntil23h = getDaysUntilDeadline(twentyThreeHoursPast, fixedNow);
      expect(daysUntil23h).toBe(-1);
      expect(daysUntil23h < 0).toBe(true);
    });

    it("returns -2 or lower for deadlines overdue by more than 24 hours", () => {
      // 25 hours in the past -> -2 days overdue
      const twentyFiveHoursPast = new Date(fixedNow - 25 * 60 * 60 * 1000).toISOString();
      const daysUntil25h = getDaysUntilDeadline(twentyFiveHoursPast, fixedNow);
      expect(daysUntil25h).toBe(-2);
      expect(daysUntil25h < 0).toBe(true);

      // 5 days in the past -> -5 days overdue
      const fiveDaysPast = new Date(fixedNow - 5 * 24 * 60 * 60 * 1000).toISOString();
      const daysUntil5d = getDaysUntilDeadline(fiveDaysPast, fixedNow);
      expect(daysUntil5d).toBe(-5);
      expect(daysUntil5d < 0).toBe(true);
    });

    it("accepts a Date object as now parameter", () => {
      const past = new Date(fixedNow - 2 * 60 * 60 * 1000).toISOString();
      expect(getDaysUntilDeadline(past, new Date(fixedNow))).toBe(-1);
    });

    it("returns 0 for invalid date strings", () => {
      expect(getDaysUntilDeadline("invalid-date-string", fixedNow)).toBe(0);
      expect(getDaysUntilDeadline("", fixedNow)).toBe(0);
    });

    it("defaults now to current time when omitted", () => {
      // An ISO date 10 days in the future relative to actual Date.now()
      const future = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
      expect(getDaysUntilDeadline(future)).toBeGreaterThanOrEqual(9);
      expect(getDaysUntilDeadline(future)).toBeLessThanOrEqual(11);
    });
  });
});
