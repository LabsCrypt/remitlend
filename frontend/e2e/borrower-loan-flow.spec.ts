import { test, expect, type Page } from "@playwright/test";

/**
 * E2E Test Suite for Borrower Loan Request Flow
 * Issue #770: Add Playwright E2E tests for borrower loan request flow
 *
 * Test Cases:
 * 1. Connect Freighter wallet (mock in CI)
 * 2. View credit score on dashboard
 * 3. Navigate to loan request form and submit
 * 4. See pending loan in loans list
 * 5. Simulate loan approval and see status update
 * 6. Submit repayment and confirm balance change
 */

// Mock wallet address for all tests
const MOCK_BORROWER_ADDRESS = "GCJPBXSE6WCQDCEYZW6C3YVZCSSCHC4AE72L5KWKCYL2CLLL7NH5VSCI";
const MOCK_CREDIT_SCORE = 715;
const MOCK_LOAN_ID = 42;

test.describe("Borrower Loan Request Flow", () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    // Mock wallet connection state via localStorage (Zustand persist)
    const walletState = {
      state: {
        status: "connected",
        address: MOCK_BORROWER_ADDRESS,
        network: { chainId: 2, name: "TESTNET", isSupported: true },
        balances: [
          { symbol: "USDC", amount: "5000.00", usdValue: 5000 },
          { symbol: "XLM", amount: "100.00", usdValue: 12.5 },
        ],
        shouldAutoReconnect: true,
      },
      version: 0,
    };

    await page.addInitScript((state: any) => {
      window.localStorage.setItem("remitlend-wallet", JSON.stringify(state));
    }, walletState);

    // Mock User Profile
    await page.route("**/api/user/profile", async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "user_borrower_1",
          email: "borrower@example.com",
          walletAddress: MOCK_BORROWER_ADDRESS,
          kycVerified: true,
        }),
      });
    });

    // Mock Pool Stats
    await page.route("**/api/pool/stats", async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            totalDeposits: 1000000,
            totalOutstanding: 450000,
            utilizationRate: 0.45,
            apy: 0.12,
            activeLoansCount: 154,
          },
        }),
      });
    });

    // Mock Loan Config
    await page.route("**/api/loans/config", async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            minScore: 500,
            maxAmount: 10000,
            interestRatePercent: 8,
            minAmount: 100,
            maxTermDays: 365,
          },
        }),
      });
    });
  });

  test("Step 1: Connect Freighter wallet (mocked)", async ({ page }: { page: Page }) => {
    await page.goto("/en");

    // Verify wallet is connected via mocked localStorage
    const walletPersist = await page.evaluate(() =>
      window.localStorage.getItem("remitlend-wallet"),
    );
    const parsed = JSON.parse(walletPersist || "{}");

    expect(parsed.state?.status).toBe("connected");
    expect(parsed.state?.address).toBe(MOCK_BORROWER_ADDRESS);

    // Verify wallet address is displayed in UI
    await expect(page.locator(`text=${MOCK_BORROWER_ADDRESS.slice(0, 8)}`)).toBeVisible();
  });

  test("Step 2: View credit score on dashboard", async ({ page }: { page: Page }) => {
    // Mock User Credit Score
    await page.route("**/api/score/*", async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          score: MOCK_CREDIT_SCORE,
          breakdown: {
            paymentHistory: 250,
            creditUtilization: 200,
            accountAge: 150,
            remittanceActivity: 115,
          },
        }),
      });
    });

    await page.goto("/en");

    // Wait for credit score to load and be displayed
    await expect(page.locator(`text=${MOCK_CREDIT_SCORE}`)).toBeVisible({ timeout: 10000 });

    // Verify score is in the expected range
    const scoreElement = page
      .locator('[data-testid="credit-score"]')
      .or(page.locator(`text=${MOCK_CREDIT_SCORE}`));
    await expect(scoreElement).toBeVisible();
  });

  test("Step 3: Navigate to loan request form and submit", async ({ page }: { page: Page }) => {
    // Mock User Credit Score
    await page.route("**/api/score/*", async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, score: MOCK_CREDIT_SCORE }),
      });
    });

    await page.goto("/en");

    // Navigate to Loan Request Form
    const applyBtn = page.getByRole("button", { name: /Apply for Loan/i });
    await applyBtn.waitFor({ timeout: 10000 });
    await applyBtn.click();

    // Fill out loan request form - Step 1: Amount & Asset
    await expect(page.locator("text=Loan Amount")).toBeVisible({ timeout: 10000 });
    await page.selectOption('select[name="asset"]', "USDC");
    await page.fill('input[placeholder="0.00"]', "1000");

    const continueToCollateral = page.getByRole("button", { name: /Continue to Collateral/i });
    await continueToCollateral.click();

    // Step 2: Collateral & NFT Link
    await expect(page.locator("text=Collateral & NFT Link")).toBeVisible();
    await page.click('input[type="checkbox"]'); // Accept terms

    const continueToSignature = page.getByRole("button", { name: /Continue to Signature/i });
    await continueToSignature.click();

    // Step 3: Transaction Signature
    await expect(page.locator("text=Ready to Sign")).toBeVisible();

    // Mock loan creation request
    await page.route("**/api/loans", async (route: any) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            success: true,
            data: {
              id: MOCK_LOAN_ID,
              status: "pending",
              txHash: "tx_abc123",
              amount: 1000,
              asset: "USDC",
              borrower: MOCK_BORROWER_ADDRESS,
            },
          }),
        });
      } else {
        await route.continue();
      }
    });

    await page.click('button:has-text("Sign & Submit Application")');

    // Verify success message
    await expect(page.locator("text=Application Submitted")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("text=Reviewing your application")).toBeVisible();
  });

  test("Step 4: See pending loan in loans list", async ({ page }: { page: Page }) => {
    // Mock borrower's loans list with pending loan
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
                totalOwed: 1080,
                status: "pending",
                interestRateBps: 800,
                termLedgers: 365,
                createdAt: new Date().toISOString(),
              },
            ],
          },
        }),
      });
    });

    await page.goto("/en");

    // Navigate to loans list or verify it's visible on dashboard
    await expect(page.locator("text=Pending")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("text=1,000")).toBeVisible(); // Loan amount
    await expect(page.locator("text=USDC")).toBeVisible();
  });

  test("Step 5: Simulate loan approval and see status update", async ({ page }: { page: Page }) => {
    // Initially mock loan as pending
    let loanStatus = "pending";

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
                totalOwed: 1080,
                status: loanStatus,
                interestRateBps: 800,
                termLedgers: 365,
                createdAt: new Date().toISOString(),
                approvedAt: loanStatus === "active" ? new Date().toISOString() : null,
              },
            ],
          },
        }),
      });
    });

    await page.goto("/en");

    // Verify loan is initially pending
    await expect(page.locator("text=Pending")).toBeVisible({ timeout: 10000 });

    // Simulate approval by updating the mock
    loanStatus = "active";

    // Trigger a refresh or navigation to see updated status
    await page.reload();

    // Verify loan status changed to active
    await expect(page.locator("text=Active")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("text=Pending")).not.toBeVisible();
  });

  test("Step 6: Submit repayment and confirm balance change", async ({ page }: { page: Page }) => {
    // Mock active loan
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

    await page.goto("/en");

    // Click repay button on the loan
    const repayBtn = page.getByRole("button", { name: /Repay/i }).first();
    await repayBtn.waitFor({ timeout: 10000 });
    await repayBtn.click();

    // Fill repayment amount
    await expect(page.locator("text=Repayment Amount")).toBeVisible();
    await page.fill('input[type="number"]', "500");

    // Mock repayment submission
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

    // Mock updated wallet balance after repayment
    const updatedWalletState = {
      state: {
        status: "connected",
        address: MOCK_BORROWER_ADDRESS,
        network: { chainId: 2, name: "TESTNET", isSupported: true },
        balances: [
          { symbol: "USDC", amount: "4500.00", usdValue: 4500 }, // Reduced by 500
          { symbol: "XLM", amount: "100.00", usdValue: 12.5 },
        ],
        shouldAutoReconnect: true,
      },
      version: 0,
    };

    await page.evaluate((state: any) => {
      window.localStorage.setItem("remitlend-wallet", JSON.stringify(state));
    }, updatedWalletState);

    // Submit repayment
    await page.click('button:has-text("Review Repayment")');
    await page.click('button:has-text("Confirm Payment")');

    // Verify success message
    await expect(page.locator("text=Repayment Successful")).toBeVisible({ timeout: 10000 });

    // Verify balance change
    await page.reload();
    await expect(page.locator("text=4,500")).toBeVisible(); // Updated USDC balance
  });

  test("Complete end-to-end borrower flow", async ({ page }: { page: Page }) => {
    // Mock User Credit Score
    await page.route("**/api/score/*", async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, score: MOCK_CREDIT_SCORE }),
      });
    });

    // Step 1: Connect wallet (already mocked in beforeEach)
    await page.goto("/en");
    await expect(page.locator(`text=${MOCK_BORROWER_ADDRESS.slice(0, 8)}`)).toBeVisible();

    // Step 2: View credit score
    await expect(page.locator(`text=${MOCK_CREDIT_SCORE}`)).toBeVisible({ timeout: 10000 });

    // Step 3: Request loan
    const applyBtn = page.getByRole("button", { name: /Apply for Loan/i });
    await applyBtn.click();

    await page.selectOption('select[name="asset"]', "USDC");
    await page.fill('input[placeholder="0.00"]', "1000");
    await page.getByRole("button", { name: /Continue to Collateral/i }).click();

    await page.click('input[type="checkbox"]');
    await page.getByRole("button", { name: /Continue to Signature/i }).click();

    // Mock loan creation
    await page.route("**/api/loans", async (route: any) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            success: true,
            data: {
              id: MOCK_LOAN_ID,
              status: "pending",
              txHash: "tx_complete_flow",
            },
          }),
        });
      } else {
        await route.continue();
      }
    });

    await page.click('button:has-text("Sign & Submit Application")');
    await expect(page.locator("text=Application Submitted")).toBeVisible({ timeout: 10000 });

    // Step 4: Verify pending loan appears
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
                status: "active",
                totalOwed: 500,
              },
            ],
          },
        }),
      });
    });

    await page.goto("/en");
    await expect(page.locator("text=Active")).toBeVisible({ timeout: 10000 });
  });
});
