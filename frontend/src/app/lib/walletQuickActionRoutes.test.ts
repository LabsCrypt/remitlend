/**
 * lib/walletQuickActionRoutes.test.ts
 *
 * Regression test for the Wallet page's locale-less Quick Actions links
 * (#1883).
 *
 * The three Quick Action cards used bare `href: "/lend"` / `"/loans"`. Every
 * route lives under `app/[locale]/…` and `middleware.ts`'s matcher only covers
 * `/` and `/(en|es|tl)/:path*`, so a bare path is never locale-redirected and
 * resolves to a 404.
 *
 * The check is done against the real filesystem rather than a snapshot of the
 * markup: the acceptance criterion is that the links *resolve*, so a hardcoded
 * copy of the expected paths would only assert that the bug still exists.
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";

const APP_DIR = join(__dirname, "..");
const WALLET_PAGE = join(APP_DIR, "[locale]", "wallet", "page.tsx");

/** Locales the middleware matcher will redirect to. */
const LOCALES = ["en", "es", "tl"];

const source = readFileSync(WALLET_PAGE, "utf8");

/**
 * Pulls the Quick Actions hrefs out of the page source.
 *
 * Only template-literal hrefs are collected, so a bare `href: "/lend"` — the
 * bug — yields no matches here and the assertions below fail loudly rather
 * than silently passing on an empty set.
 */
function quickActionHrefs(): string[] {
  const matches = source.matchAll(/href:\s*`\/\$\{locale\}([^`]*)`/g);
  return [...matches].map((match) => match[1]);
}

describe("wallet page Quick Action routes (#1883)", () => {
  const hrefs = quickActionHrefs();

  it("builds every Quick Action href with the active locale", () => {
    // Guards the extraction itself: if this is 0, the assertions on real
    // routes below are vacuous.
    expect(hrefs.length).toBeGreaterThanOrEqual(3);
  });

  it("contains no locale-less route href", () => {
    const bare = [...source.matchAll(/href:\s*"\/([^"]*)"/g)].map((match) => match[1]);
    expect(bare).toEqual([]);
  });

  it.each(hrefs)("resolves /${locale}%s to a real route", (path) => {
    for (const locale of LOCALES) {
      expect(existsSync(join(APP_DIR, "[locale]", path))).toBe(true);
      expect(path.startsWith("/")).toBe(true);
      expect(locale).toMatch(/^(en|es|tl)$/);
    }
  });

  it("covers both the lend and loans destinations", () => {
    expect(hrefs).toContain("/lend");
    expect(hrefs).toContain("/loans");
  });
});
