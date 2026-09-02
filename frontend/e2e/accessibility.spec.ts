import { test, expect } from "@playwright/test";
import { injectAxe, getViolations } from "axe-playwright";

test.describe("Accessibility audit", () => {
  test("landing page has no critical a11y violations", async ({ page }) => {
    await page.goto("/");
    await injectAxe(page);

    const violations = await getViolations(page, undefined, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "best-practice"],
      },
    });

    const critical = violations.filter((v) => v.impact === "critical" || v.impact === "serious");

    expect(critical, `Found ${critical.length} critical/serious a11y violations`).toEqual([]);
  });
});
