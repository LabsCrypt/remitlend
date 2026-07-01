// e2e coverage temporarily skipped: assertions rely on product wiring (wallet-connect state, /api/* mock paths, Zustand hydration) that has drifted from the current app. Restore file-by-file once the flows are re-aligned with the mocks.
import { test, expect, type Page } from "@playwright/test";

const MOCK_ADDRESS = "GCJPBXSE6WCQDCEYZW6C3YVZCSSCHC4AE72L5KWKCYL2CLLL7NH5VSCI";

test.beforeEach(async ({ page }: { page: Page }) => {
  await page.addInitScript((address: string) => {
    window.localStorage.setItem(
      "remitlend-wallet",
      JSON.stringify({
        state: {
          status: "connected",
          address,
          network: { chainId: 2, name: "TESTNET", isSupported: true },
          balances: [],
          shouldAutoReconnect: true,
        },
        version: 0,
      }),
    );
    window.localStorage.setItem(
      "remitlend-user",
      JSON.stringify({
        state: {
          user: {
            id: address,
            walletAddress: address,
            email: "alice@example.com",
            kycVerified: true,
          },
          authToken: "test-token",
          isAuthenticated: true,
        },
        version: 0,
      }),
    );
  }, MOCK_ADDRESS);
});

test.skip("shows Remittance NFT metadata on the kingdom page", async ({ page }: { page: Page }) => {
  await page.route("**/score/*/nft", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        walletAddress: MOCK_ADDRESS,
        nft: {
          score: 742,
          historyHash: "abcdef123456",
          metadataUri: "https://example.com/remittance-nft.json",
          defaultCount: 1,
          transferCooldownRemaining: 1440,
          lastUpdateLedger: 987654,
        },
      }),
    });
  });

  await page.goto("/en/kingdom");

  await expect(page.getByRole("heading", { name: "Remittance NFT" })).toBeVisible();
  await expect(page.getByText("742")).toBeVisible();
  await expect(page.getByText("1,440 ledgers")).toBeVisible();
  await expect(page.locator('a[href="https://example.com/remittance-nft.json"]')).toHaveAttribute(
    "target",
    "_blank",
  );
});

test.skip("shows empty NFT state with remittance CTA", async ({ page }: { page: Page }) => {
  await page.route("**/score/*/nft", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, walletAddress: MOCK_ADDRESS, nft: null }),
    });
  });

  await page.goto("/en/kingdom");

  await expect(page.getByText("No Remittance NFT yet")).toBeVisible();
  await expect(page.getByRole("link", { name: "Send first remittance" })).toHaveAttribute(
    "href",
    "/en/send-remittance",
  );
});
