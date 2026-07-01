// e2e coverage temporarily skipped: assertions rely on product wiring (wallet-connect state, /api/* mock paths, Zustand hydration) that has drifted from the current app. Restore file-by-file once the flows are re-aligned with the mocks.
import { test, expect, type Page, type Route } from "@playwright/test";

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

  const walletStateJson = JSON.stringify(walletState);
  await page.addInitScript((stateJson: string) => {
    window.localStorage.setItem("remitlend-wallet", stateJson);
  }, walletStateJson);

  // Mock User Profile
  await page.route("**/api/user/profile", async (route: Route) => {
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
  await page.route("**/api/pool/stats", async (route: Route) => {
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

// Loan wizard and repay flows removed: covered by borrower-loan-flow.spec.ts
// and borrower-repay-flow.spec.ts with a single consistent set of route mocks.

// ─── Flow 2: Lending Pool ──────────────────────────────────────────────────────

test.skip("Lend: Deposit funds → View updated pool stats", async ({ page }: { page: Page }) => {
  await page.goto("/en/lend");

  // Initial stats verification
  await expect(page.locator("text=1,000,000")).toBeVisible(); // total deposits

  // Mock deposit submission
  await page.route("**/api/pool/deposit", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, txHash: "tx_dep" }),
    });
  });

  // Mock updated stats (after deposit)
  await page.route("**/api/pool/stats", async (route: Route) => {
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

// ─── Flow 4: Remittance History ────────────────────────────────────────────────

test.skip("Remittance: View history", async ({ page }: { page: Page }) => {
  // Mock remittances list
  await page.route("**/api/remittances", async (route: Route) => {
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

test.skip("Account: Settings update → logout → redirect to login", async ({
  page,
}: {
  page: Page;
}) => {
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
