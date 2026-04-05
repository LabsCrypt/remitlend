import { test, expect, type Page } from "@playwright/test";

// Mock wallet address for all tests
const MOCK_ADDRESS = "GCJPBXSE6WCQDCEYZW6C3YVZCSSCHC4AE72L5KWKCYL2CLLL7NH5VSCI";

// ─── Setup Before Each Test ───────────────────────────────────────────────────

test.beforeEach(async ({ page }: { page: Page }) => {
  // Mock wallet connection state via localStorage (Zustand persist)
  const walletState = {
    state: {
      status: "connected",
      address: MOCK_ADDRESS,
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
        id: "user_1",
        email: "alice@example.com",
        walletAddress: MOCK_ADDRESS,
        kycVerified: true,
      }),
    });
  });

  // Mock initial Pool Stats
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
});

// ─── Flow 1: Loan Wizard ───────────────────────────────────────────────────────

test("Borrow: Connect wallet → Request Loan → Wizard steps", async ({ page }: { page: Page }) => {
  // Mock Loan Config (min score, etc)
  await page.route("**/api/loans/config", async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: { minScore: 500, maxAmount: 10000, interestRatePercent: 8 },
      }),
    });
  });

  // Mock User Credit Score
  await page.route("**/api/score/*", async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, score: 715 }),
    });
  });

  await page.goto("/en"); // Explicitly go to English locale

  // Navigate to Loan Wizard (via Apply button in quick actions)
  // Text matches HomePage.quickActions.applyLoan in en.json
  const applyBtn = page.getByRole("button", { name: /Apply for Loan/i });
  await applyBtn.waitFor();
  await applyBtn.click();

  // Step 1: Amount & Asset
  await expect(page.locator("text=Loan Amount")).toBeVisible();
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

  // Mock creation request
  await page.route("**/api/loans", async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: "loan_123", status: "pending", txHash: "tx_abc" }),
    });
  });

  await page.click('button:has-text("Sign & Submit Application")');

  // Success view
  await expect(page.locator("text=Application Submitted")).toBeVisible();
  await expect(page.locator("text=Reviewing your application")).toBeVisible();
});

// ─── Flow 2: Lending Pool ──────────────────────────────────────────────────────

test("Lend: Deposit funds → View updated pool stats", async ({ page }: { page: Page }) => {
  await page.goto("/en/lend");

  // Initial stats verification
  await expect(page.locator("text=1,000,000")).toBeVisible(); // total deposits

  // Mock deposit submission
  await page.route("**/api/pool/deposit", async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, txHash: "tx_dep" }),
    });
  });

  // Mock updated stats (after deposit)
  await page.route("**/api/pool/stats", async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          totalDeposits: 1002500, // +$2500
          totalOutstanding: 450000,
          utilizationRate: 0.448,
          apy: 0.12,
          activeLoansCount: 154,
        },
      }),
    });
  });

  // Perform deposit
  await page.fill('input[placeholder="0.00"]', "2500");
  // Exact button text from lend/page.tsx: "Deposit"
  const depositBtn = page.getByRole("button", { name: /^Deposit$/ });
  await depositBtn.click();

  // Verify success toast or UI update
  await expect(page.locator("text=1,002,500")).toBeVisible();
});

// ─── Flow 3: Repayment ─────────────────────────────────────────────────────────

test("Borrower: Repay loan → Confirm transaction → Check status update", async ({
  page,
}: {
  page: Page;
}) => {
  // Mock existing loans for borrower
  await page.route("**/api/loans/borrower/**", async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          borrower: MOCK_ADDRESS,
          loans: [
            {
              id: 123,
              principal: 1000,
              totalOwed: 500,
              status: "active",
              nextPaymentDeadline: "2026-12-31T00:00:00Z",
            },
          ],
        },
      }),
    });
  });

  await page.goto("/en");

  // Click repay on the specific loan (assuming dashboard has a 'Repay' button in the loans list or card)
  const repayBtn = page.getByRole("button", { name: "Repay" }).first();
  await repayBtn.click();

  // Perform repayment
  await expect(page.locator("text=Repayment Amount")).toBeVisible();
  await page.fill('input[type="number"]', "500");

  // Mock repayment finish
  await page.route("**/api/loans/123/repay", async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, txHash: "tx_repay" }),
    });
  });

  await page.click('button:has-text("Review Repayment")');
  await page.click('button:has-text("Confirm Payment")'); // assuming it's in the preview modal

  // Success message
  await expect(page.locator("text=Progress")).toBeVisible(); // transaction progress
  await expect(page.locator("text=Repayment Successful")).toBeVisible();
});

// ─── Flow 4: Remittance History ────────────────────────────────────────────────

test("Remittance: View history", async ({ page }: { page: Page }) => {
  // Mock remittances list
  await page.route("**/api/remittances", async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "rem_1",
          amount: 250,
          fromCurrency: "USDC",
          toCurrency: "NGN",
          status: "completed",
          createdAt: new Date().toISOString(),
          recipientAddress: "0x123...",
        },
      ]),
    });
  });

  await page.goto("/en/remittances");

  await expect(page.locator("text=History")).toBeVisible();
  await expect(page.locator("text=$250.00")).toBeVisible(); // formatting might vary
  await expect(page.locator("text=NGN")).toBeVisible();
  await expect(page.locator("text=Completed")).toBeVisible();
});

// ─── Flow 5: Settings & Logout ────────────────────────────────────────────────

test("Account: Settings update → logout → redirect to login", async ({ page }: { page: Page }) => {
  await page.goto("/en/settings");

  // Profile update check (resolve strict mode by using heading)
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

  // Fill profile field
  const displayNameInput = page.getByRole("textbox", { name: /Display Name/i });
  await displayNameInput.fill("Alice New Name");

  await page.click('button:has-text("Save Profile")');
  await expect(page.locator("text=Saved!")).toBeVisible();

  // Logout flow
  const logoutBtn = page.getByRole("button", { name: /Disconnect Wallet/i });
  await logoutBtn.scrollIntoViewIfNeeded();
  await logoutBtn.click();

  // Redirection check (after logout, the app usually clears session and redirects to landed/base with localized path)
  await expect(page).toHaveURL(/.*\/en$/);

  // Verify localStorage cleared
  const walletPersist = await page.evaluate(() => window.localStorage.getItem("remitlend-wallet"));
  const parsed = JSON.parse(walletPersist || "{}");
  expect(parsed.state?.status).toBe("disconnected");
});
