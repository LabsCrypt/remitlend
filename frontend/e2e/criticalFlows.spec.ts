import { test, expect } from "@playwright/test";

test("critical user flow: connect wallet → dashboard → loan → repay → score", async ({ page }) => {
  // Go to homepage
  await page.goto("/"); // baseURL from config is http://localhost:3000

  // Mock wallet connection immediately (if using a wallet popup)
  await page.evaluate(() => {
    localStorage.setItem("mockWalletConnected", "true");
  });

  // Dashboard should now be visible
  const dashboard = page.locator("text=Dashboard"); // fallback: adjust if your app uses a different text
  await dashboard.waitFor({ timeout: 60000 });
  await expect(dashboard).toBeVisible();

  // Request loan
  const requestLoanButton = page.locator('button:has-text("Request Loan")'); // uses button element containing text
  await requestLoanButton.waitFor({ timeout: 60000 });
  await requestLoanButton.click();
  await expect(page.locator("text=Loan Requested")).toBeVisible();

  // Repay loan
  const repayButton = page.locator('button:has-text("Repay Loan")'); // safer than text=
  await repayButton.waitFor({ timeout: 60000 });
  await repayButton.click();
  await expect(page.locator("text=Loan Repaid")).toBeVisible();

  // Check score
  const checkScoreButton = page.locator('button:has-text("Check Score")'); // button containing text
  await checkScoreButton.waitFor({ timeout: 60000 });
  await checkScoreButton.click();
  await expect(page.locator("text=Score")).toBeVisible();
});
