# Follow-Up: User-Facing Service Worker Update Prompt

**Created:** 2026-09-01
**Related Issue:** #1511
**Status:** Open — Not yet implemented

## Problem

After a production deployment, users who have an open tab do not automatically
receive the updated application. The service worker (`frontend/src/app/sw.ts`)
installs and activates immediately thanks to `skipWaiting` and `clientsClaim`,
but **there is no UI to inform the user that a new version is available** and
prompt them to refresh.

This means:

- A tab that has been open since before the deploy continues serving the old
  precached code.
- The user has no visual indication that they are on a stale version.
- Only a manual page refresh or navigating to a new route picks up the update.

## Proposed Solution (not yet implemented)

Add a lightweight "update available" banner or toast that:

1. Listens for the `controllerchange` event on the `navigator.serviceWorker`
   controller (fired when a new SW activates and claims the page).
2. Shows a non-intrusive notification (e.g., a toast via Sonner) saying
   "A new version is available — refresh to update."
3. Optionally offers a "Refresh now" button that calls `window.location.reload()`.

### Implementation Notes

- The `controllerchange` event is the most reliable signal because it fires
  exactly when a new SW takes over the page.
- Serwist also provides a `useServiceWorkerUpdate` hook (from
  `@serwist/react`) that can be used in React components to detect pending
  or waiting updates.
- The banner should be dismissible and should not block interaction with the
  page.

## Files to Modify

- `frontend/src/app/components/global_ui/` — Add an `UpdateBanner` component
- `frontend/src/app/[locale]/layout.tsx` — Mount the banner in the app shell
- `frontend/src/app/sw.ts` — Potentially add a `postMessage` to notify clients

## Acceptance Criteria

- [ ] User sees a non-blocking notification when a new SW version activates
- [ ] Notification offers a "Refresh now" action
- [ ] Notification can be dismissed without refreshing
- [ ] No regression in offline behavior or cache performance

---

> This follow-up was tracked as part of Issue #1511 documentation.
