import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry } from "@serwist/precaching";
import { Serwist } from "serwist";

declare const self: ServiceWorkerGlobalScopeEventMap;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST as PrecacheEntry[],
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
  bypassCdn: ({ request }) => {
    if (
      request.url.includes("/api/") ||
      request.url.includes("/sse/") ||
      request.url.includes("/_next/")
    ) {
      return true;
    }
    return false;
  },
});

serwist.addEventListeners();
