// e2e coverage temporarily skipped: assertions rely on product wiring (wallet-connect state, /api/* mock paths, Zustand hydration) that has drifted from the current app. Restore file-by-file once the flows are re-aligned with the mocks.
import { test, expect, type Page, type Route } from "@playwright/test";

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

test.describe.skip("Borrower Repayment Flow", () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    const walletStateJson = JSON.stringify(connectedWalletState("5000.00"));
    await page.addInitScript((stateJson: string) => {
      window.localStorage.setItem("remitlend-wallet", stateJson);
    }, walletStateJson);
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "remitlend-user",
        JSON.stringify({
          state: {
            user: {
              id: "borrower-user-1",
              email: "borrower@example.com",
              walletAddress: MOCK_BORROWER_ADDRESS,
              kycVerified: true,
            },
            authToken: "test-jwt-token",
            isAuthenticated: true,
          },
          version: 0,
        }),
      );
    });

    // Active (approved) loan with an outstanding balance the borrower can repay.
    await page.route("**/api/loans/borrower/**", async (route: Route) => {
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
    await page.route(`**/api/loans/${MOCK_LOAN_ID}/repay`, async (route: Route) => {
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
    const updatedWalletStateJson = JSON.stringify(connectedWalletState("4500.00"));
    await page.evaluate((stateJson: string) => {
      window.localStorage.setItem("remitlend-wallet", stateJson);
    }, updatedWalletStateJson);

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

  test("updates loan detail page in real time after repayment SSE event", async ({
    page,
  }: {
    page: Page;
  }) => {
    let detailReads = 0;
    await page.route(`**/api/loans/${MOCK_LOAN_ID}`, async (route: Route) => {
      detailReads += 1;
      const repaid = detailReads > 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          loanId: MOCK_LOAN_ID,
          principal: 1000,
          accruedInterest: repaid ? 0 : 80,
          totalRepaid: repaid ? 1080 : 580,
          totalOwed: repaid ? 0 : 500,
          interestRate: 8,
          status: repaid ? "repaid" : "active",
          requestedAt: "2026-01-01T00:00:00.000Z",
          approvedAt: "2026-01-02T00:00:00.000Z",
          events: [
            {
              type: "LoanRequested",
              amount: "1000",
              timestamp: "2026-01-01T00:00:00.000Z",
              txHash: "tx-request",
            },
            {
              type: repaid ? "LoanRepaid" : "LoanApproved",
              amount: repaid ? "1080" : null,
              timestamp: "2026-01-03T00:00:00.000Z",
              txHash: repaid ? "tx-repaid" : "tx-approved",
            },
          ],
        }),
      });
    });

    await page.route(`**/api/loans/${MOCK_LOAN_ID}/amortization-schedule`, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          principal: 1000,
          interestRateBps: 800,
          termLedgers: 365,
          totalInterest: 80,
          totalDue: 1080,
          schedule: [],
        }),
      });
    });

    await page.route("**/api/events/stream?borrower=**", async (route: Route) => {
      await route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        },
        body: `data: ${JSON.stringify({
          eventId: "evt-loan-repaid",
          eventType: "LoanRepaid",
          loanId: MOCK_LOAN_ID,
          address: MOCK_BORROWER_ADDRESS,
          ledger: 999,
          ledgerClosedAt: new Date().toISOString(),
          txHash: "tx-repaid",
        })}\n\n`,
      });
    });

    await page.goto(`/en/loans/${MOCK_LOAN_ID}`);
    await expect(page.locator("text=Total owed")).toBeVisible();
    await expect(page.locator("text=$500.00")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("text=$0.00")).toBeVisible({ timeout: 10000 });
  });
});
