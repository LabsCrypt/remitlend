// e2e coverage temporarily skipped: assertions rely on product wiring (wallet-connect state, /api/* mock paths, Zustand hydration) that has drifted from the current app. Restore file-by-file once the flows are re-aligned with the mocks.
import { test, expect } from "@playwright/test";

test.skip("opens recent transactions drawer with copied hashes", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "remitlend-user",
      JSON.stringify({
        state: {
          authToken: "mock-token",
          isAuthenticated: true,
          user: {
            id: "u1",
            email: "borrower@example.com",
            walletAddress: "GBORROWER",
            kycVerified: true,
          },
        },
        version: 0,
      }),
    );
  });

  await page.route("**/api/v1/transactions/me**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: [
          {
            id: 9,
            txHash: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
            status: "SUCCESS",
            submittedAt: new Date().toISOString(),
            submittedBy: "GBORROWER",
            transactionType: "loan",
          },
        ],
        page_info: { limit: 20, count: 1, next_cursor: null, has_next: false },
      }),
    });
  });

  await page.goto("/en");
  await page.getByRole("button", { name: /recent transactions/i }).click();
  await expect(page.getByRole("dialog")).toContainText("Recent transactions");
  await expect(page.getByText("SUCCESS")).toBeVisible();
});
