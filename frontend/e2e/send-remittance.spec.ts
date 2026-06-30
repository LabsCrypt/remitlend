import { test, expect, type Page, type Route } from "@playwright/test";

const MOCK_SENDER_ADDRESS = "GCJPBXSE6WCQDCEYZW6C3YVZCSSCHC4AE72L5KWKCYL2CLLL7NH5VSCI";
const VALID_RECIPIENT = "GADR4OJZ2A6Q7V4YHLQED7XN3YXC2B5S6T7U8A9B0C1D2E3F4G5H6J7K8L9M";

function seedConnectedWallet(state: { status: string; address: string }) {
  return {
    state: {
      ...state,
      network: { chainId: 2, name: "TESTNET", isSupported: true },
      balances: [
        { symbol: "USDC", amount: "5000.00", usdValue: 5000 },
        { symbol: "XLM", amount: "100.00", usdValue: 12.5 },
      ],
      shouldAutoReconnect: true,
    },
    version: 0,
  };
}

async function setupMocks(page: Page) {
  await page.route("**/api/user/profile", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "user_1",
        email: "alice@example.com",
        walletAddress: MOCK_SENDER_ADDRESS,
        kycVerified: true,
      }),
    });
  });

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
}

test.describe("Send Remittance Flow", () => {
  test("shows connect-wallet warning when wallet is not connected", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "remitlend-wallet",
        JSON.stringify({
          state: { status: "disconnected", address: null },
          version: 0,
        }),
      );
    });
    await setupMocks(page);
    await page.goto("/en/send-remittance");

    await expect(
      page.locator("text=Please connect your Stellar wallet to send remittances"),
    ).toBeVisible();
  });

  test("validates recipient address on submit", async ({ page }) => {
    const walletState = JSON.stringify(
      seedConnectedWallet({ status: "connected", address: MOCK_SENDER_ADDRESS }),
    );
    await page.addInitScript((stateJson: string) => {
      window.localStorage.setItem("remitlend-wallet", stateJson);
    }, walletState);
    await setupMocks(page);
    await page.goto("/en/send-remittance");

    await expect(page.locator("text=Send Remittance")).toBeVisible();

    await page.fill("#recipientAddress", "invalid-address");
    await page.fill("#amount", "100");

    await page.getByRole("button", { name: /Review & Send/i }).click();

    await expect(page.locator("text=Invalid Stellar address format")).toBeVisible();
  });

  test("sends a remittance successfully and redirects to history", async ({ page }) => {
    const walletState = JSON.stringify(
      seedConnectedWallet({ status: "connected", address: MOCK_SENDER_ADDRESS }),
    );
    await page.addInitScript((stateJson: string) => {
      window.localStorage.setItem("remitlend-wallet", stateJson);
    }, walletState);
    await setupMocks(page);

    await page.route("**/api/remittances", async (route: Route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true, txHash: "tx_rem_abc" }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([]),
        });
      }
    });

    await page.goto("/en/send-remittance");

    await expect(page.locator("text=Send Remittance")).toBeVisible();

    await page.fill("#recipientAddress", VALID_RECIPIENT);
    await page.fill("#amount", "250");

    await page.getByRole("button", { name: /Review & Send/i }).click();

    const confirmBtn = page.getByRole("button", { name: /Confirm|Send/i }).first();
    await expect(confirmBtn).toBeVisible({ timeout: 5000 });
    await confirmBtn.click();

    await expect(page.locator("text=Remittance sent successfully")).toBeVisible({ timeout: 10000 });

    await page.waitForURL("**/remittances", { timeout: 5000 });
  });
});
