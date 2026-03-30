import { test, expect } from "@playwright/test";

test.describe("Landing Page", () => {
  test("should load the landing page successfully", async ({ page }) => {
    await page.goto("/en"); // Localized home
    // Check for title or specific branding
    await expect(page).toHaveTitle(/remitlend/i);

    // Verify main content structure (Dashboard heading in [locale]/page.tsx)
    await expect(page.getByRole("heading", { name: /Dashboard/i })).toBeVisible();
  });

  test("should display wallet connection prompt when disconnected", async ({ page }) => {
    // Ensure localStorage is empty for this test
    await page.addInitScript(() => window.localStorage.clear());
    await page.goto("/en");

    await expect(page.locator("text=Wallet Not Connected")).toBeVisible();
    await expect(page.getByRole("button", { name: /Connect Wallet/i })).toBeVisible();
  });

  test("should show localized help text for new visitors", async ({ page }) => {
    await page.goto("/en");
    await expect(
      page.locator("text=Welcome to RemitLend. Please connect your wallet"),
    ).toBeVisible();
  });
});
