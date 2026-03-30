# RemitLend Frontend and Backend Performance Improvements

This PR implements several key frontend improvements for RemitLend, focusing on UX consistency, precision enforcement, and session management. It also addresses a failing backend test in the Event Indexer.

## Implementation Details

### Frontend Improvements

1.  **Consistent Empty States (#580)**:
    *   Introduced a reusable `EmptyState` component which simplifies logic across the app.
    *   Refactored the Activity Page, Loans Page, and Dashboard recent activity section.
    *   Added a `cn` utility for flexible Tailwind class merging.

2.  **Decimal Precision Enforcement (#578)**:
    *   Created a precision utility (`truncateDecimals`) to enforce asset-specific decimal limits (XLM: 7, USDC/EURC: 2) on user inputs.
    *   Updated `RemittanceForm`, `LoanRepaymentForm`, and asset-amount steps to prevent invalid Stellar transaction submissions.

3.  **Logout and Session Expiry Flow (#562)**:
    *   Implemented a unified `useLogout` hook to clear all app stores and caches.
    *   Added a global `SessionExpiryHandler` that listens for 401 responses and triggers a clean redirect.

4.  **Modal Accessibility (#567)**:
    *   Audited the `Modal` component and confirmed full compliance with focus-trapping and keyboard accessibility standards.

### Backend Fixes

1.  **Event Indexer Test Stability**:
    *   Fixed `src/__tests__/eventIndexer.test.ts` which was failing in CI due to ESM-related missing imports (`expect`, `describe`, etc.).
    *   Aligned the test expectation with the batched/bulk user score update logic used in the indexer service.

## Verification

- **Frontend**: Manual testing of forms (precision) and logout flow.
- **Backend**: Verified that `eventIndexer.test.ts` now uses correct Jest globals and its assertions match the bulk query structure.

Fixes: #580 fixed
Fixes: #578 fixed
Fixes: #562 fixed
Fixes: #567 fixed
