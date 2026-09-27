import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry } from "@serwist/precaching";
import { Serwist } from "serwist";

declare const self: WorkerGlobalScope & {
  __SW_MANIFEST: PrecacheEntry[];
};

/**
 * Cache Invalidation & Update Strategy
 * =====================================
 *
 * This service worker uses Serwist's precaching model to ensure users receive
 * updated assets after a new deployment. Here is how the cache invalidation
 * and update flow works end-to-end:
 *
 * 1. PRECACHE MANIFEST
 * --------------------
 * `self.__SW_MANIFEST` is auto-generated at build time by Serwist/Next.js.
 * Every file in the manifest is hashed (content-addressed URLs), so a new
 * build produces new URLs. When the browser encounters a new manifest entry
 * that doesn't exist in the current cache, it downloads the fresh asset.
 *
 * 2. UPDATES AND ACTIVATION
 * -------------------------
 * - `skipWaiting: true` — the new service worker activates immediately on
 *   installation, without waiting for existing tabs to close. This ensures
 *   the latest precache manifest takes effect as soon as possible.
 * - `clientsClaim: true` — once activated, the new service worker takes
 *   control of all open client pages right away, so subsequent navigations
 *   and fetches go through the updated worker.
 *
 * Together these two flags mean: after a user refreshes or revisits the page,
 * the browser installs the new SW, it activates immediately, claims all tabs,
 * and the next navigation or fetch will use fresh cached assets.
 *
 * 3. RUNTIME CACHING (non-precached requests)
 * -------------------------------------------
 * `defaultCache` from `@serwist/next/worker` applies network-first or
 * cache-first strategies to runtime requests (fonts, images, API calls, etc.)
 * depending on the request type. These caches are independent of the
 * precache; they are overwritten when a new SW version processes the same
 * request because the precache entries (with hashed URLs) take priority.
 *
 * 4. CDN BYPASS
 * ------------
 * The `bypassCdn` predicate prevents Serwist from serving cached API, SSE,
 * and Next.js internal (`/_next/`) responses from cache when the CDN is
 * in the way. These requests always go to the network so that stale data
 * is never served.
 *
 * 5. WHAT IS CURRENTLY MISSING
 * ----------------------------
 * There is no user-facing "update available" prompt or notification. The
 * user only gets the new version on their next page refresh/navigation. If
 * a tab has been open for a long time, it will keep serving the old
 * precached assets until the user refreshes or the browser recycles the tab.
 * See docs/FOLLOWUP-sw-update-prompt.md for tracking this gap.
 */

const serwist = new Serwist({
  // Precache entries are generated at build time by Serwist + Next.js.
  // Each entry has a content-hashed URL, so a new build naturally
  // produces a different manifest and invalidates old cache entries.
  precacheEntries: self.__SW_MANIFEST,

  // Activate the new service worker immediately without waiting for
  // existing tabs to close. This ensures the updated precache manifest
  // is live as soon as the new SW installs.
  skipWaiting: true,

  // Once activated, claim all open client pages so they begin using
  // the new service worker right away — no "refresh required" delay
  // for navigation requests.
  clientsClaim: true,

  // Enable navigation preload so that navigation requests hit the network
  // immediately instead of waiting for the SW to spin up; the response is
  // used if the network is fast, otherwise the cached version is served.
  navigationPreload: true,

  // Runtime caching rules for requests not in the precache manifest.
  // Default strategies (network-first for pages, cache-first for static
  // assets, etc.) are provided by @serwist/next/worker.
  runtimeCaching: defaultCache,

  // Prevent Serwist from serving stale cached responses for API, SSE,
  // and Next.js internal requests. These should always hit the network
  // to avoid returning outdated data.
  bypassCdn: ({ request }: { request: Request }) => {
    if (
      request.url.includes("/api/") ||
      request.url.includes("/sse/") ||
      request.url.includes("/_next/")
    ) {
      return true;
    }
    return false;
  },
} as ConstructorParameters<typeof Serwist>[0] & {
  bypassCdn: (context: { request: Request }) => boolean;
});

// Register all event listeners (install, activate, fetch, message, etc.)
// that Serwist needs to manage the service worker lifecycle.
serwist.addEventListeners();
