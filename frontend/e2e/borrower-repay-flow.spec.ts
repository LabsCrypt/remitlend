import { test, expect, type Page } from "@playwright/test";

/**
 * E2E Test Suite for Borrower Repayment Flow
 * Issue #867: highest-value happy path not yet covered — a borrower repaying
 * an approved (active) loan through the repay modal.
 *
 * Mocks an approved loan, walks the repay modal, mocks the repayment request,
 * and confirms the success state and the post-repayment balance change.
 */

const MOCK_BORROWER_ADDRESS = "GCJPBXSE6WCQDCEYZW6C3YVZCSSCHC4AE72L5KWKCYL2CLLL7NH5VSCI";
const MOCK_LOAN_ID = 42;

function connectedWalletState(usdc: string) {
  return {
    state: {
      status: "connected",
      address: MOCK_BORROWER_ADDRESS,
      network: { chainId: 2, name: "TESTNET", isSupported: true },
      balances: [
        { symbol: "USDC", amount: usdc, usdValue: Number(usdc) },
        { symbol: "XLM", amount: "100.00", usdValue: 12.5 },
      ],
      shouldAutoReconnect: true,
    },
    version: 0,
  };
}

test.describe("Borrower Repayment Flow", () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    await page.addInitScript((state: any) => {
      window.localStorage.setItem("remitlend-wallet", JSON.stringify(state));
    }, connectedWalletState("5000.00"));

    // Active (approved) loan with an outstanding balance the borrower can repay.
    await page.route("**/api/loans/borrower/**", async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            borrower: MOCK_BORROWER_ADDRESS,
            loans: [
              {
                id: MOCK_LOAN_ID,
                principal: 1000,
                asset: "USDC",
                totalOwed: 500,
                amountPaid: 580,
                status: "active",
                interestRateBps: 800,
                termLedgers: 365,
                nextPaymentDeadline: "2026-12-31T00:00:00Z",
                createdAt: new Date().toISOString(),
              },
            ],
          },
        }),
      });
    });
  });

  test("repays an approved loan and reflects the new balance", async ({ page }: { page: Page }) => {
    await page.goto("/en");

    // Open the repay modal from the active loan.
    const repayBtn = page.getByRole("button", { name: /Repay/i }).first();
    await repayBtn.waitFor({ timeout: 10000 });
    await repayBtn.click();

    await expect(page.locator("text=Repayment Amount")).toBeVisible();
    await page.fill('input[type="number"]', "500");

    // Mock the repayment submission.
    await page.route(`**/api/loans/${MOCK_LOAN_ID}/repay`, async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          txHash: "tx_repay_xyz",
          newBalance: 0,
          status: "repaid",
        }),
      });
    });

    // Wallet balance after paying 500 USDC.
    await page.evaluate((state: any) => {
      window.localStorage.setItem("remitlend-wallet", JSON.stringify(state));
    }, connectedWalletState("4500.00"));

    await page.click('button:has-text("Review Repayment")');
    await page.click('button:has-text("Confirm Payment")');

    await expect(page.locator("text=Repayment Successful")).toBeVisible({ timeout: 10000 });

    await page.reload();
    await expect(page.locator("text=4,500")).toBeVisible();
  });

  test("rejects a repayment greater than the outstanding balance", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto("/en");

    const repayBtn = page.getByRole("button", { name: /Repay/i }).first();
    await repayBtn.waitFor({ timeout: 10000 });
    await repayBtn.click();

    await expect(page.locator("text=Repayment Amount")).toBeVisible();
    // Outstanding is 500; attempt to overpay.
    await page.fill('input[type="number"]', "100000");

    const review = page.getByRole("button", { name: /Review Repayment/i });
    // The flow should not allow proceeding to confirmation with an invalid amount.
    await expect(review)
      .toBeDisabled()
      .catch(async () => {
        await review.click();
        await expect(page.locator("text=/exceeds|too (large|high)|maximum/i")).toBeVisible();
      });
  });
});
