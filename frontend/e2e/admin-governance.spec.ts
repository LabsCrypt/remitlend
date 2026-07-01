import { test, expect } from "@playwright/test";

test("admin can view pending governance proposal", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "remitlend-user",
      JSON.stringify({
        state: {
          authToken: "mock-admin-token",
          isAuthenticated: true,
          user: {
            id: "admin",
            email: "admin@example.com",
            walletAddress: "GADMIN",
            role: "admin",
            kycVerified: true,
          },
        },
        version: 0,
      }),
    );
  });

  await page.route("**/admin/governance/pending", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        currentAdmin: "GADMINCURRENT",
        targetContract: "CCONTRACT",
        pendingProposal: {
          id: "proposal-1",
          proposedAdmin: "GNEWADMIN",
          approvalCount: 1,
          threshold: 2,
          executableAt: new Date(Date.now() + 60_000).toISOString(),
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          signers: [
            { address: "GSIGNER1", approved: true },
            { address: "GSIGNER2", approved: false },
          ],
        },
      }),
    });
  });

  await page.goto("/en/admin/governance");
  await expect(page.getByRole("heading", { name: /governance console/i })).toBeVisible();
  await expect(page.getByText("proposal-1")).toBeVisible();
  await expect(page.getByText("1/2")).toBeVisible();
});
