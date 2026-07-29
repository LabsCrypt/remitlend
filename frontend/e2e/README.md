# End-to-End Test Suite

This directory contains Playwright e2e specs for RemitLend. Each spec file owns
a single user flow so that mock shapes stay consistent and coverage gaps are
easy to spot.

## Spec Responsibilities

| Spec file                      | Unique responsibility                                                    |
| ------------------------------ | ------------------------------------------------------------------------ |
| `admin-governance.spec.ts`     | Admin views and votes on governance proposals                            |
| `borrower-loan-flow.spec.ts`   | Full borrower loan-request lifecycle (wallet, score, apply, approve)     |
| `borrower-repay-flow.spec.ts`  | Borrower repays an active loan and confirms balance update               |
| `criticalFlows.spec.ts`        | Lending-pool deposit, remittance history, and settings/logout flows      |
| `landing-page.spec.ts`         | Landing page load, wallet prompt, and basic navigation                   |
| `lender-withdraw-flow.spec.ts` | Lender withdraws deposited liquidity from the pool                       |
| `notifications-inbox.spec.ts`  | Notification badge, inbox drawer, and mark-as-read                       |
| `recent-transactions.spec.ts`  | Recent transactions drawer with copied hashes                            |
| `remittance-nft-viewer.spec.ts`| Viewing and inspecting minted remittance NFTs                            |
| `send-remittance.spec.ts`      | Sending a remittance to a recipient address                              |

## Adding a New Spec

Before creating a new spec file, check the table above:

- [ ] **No existing spec already covers the flow.** If one does, extend it
      rather than creating a new file with overlapping route mocks.
- [ ] **The new spec owns exactly one user flow.** Each file should test a
      distinct area of the app so that failures pinpoint the broken feature.
- [ ] **Update this table.** Add a row describing the new spec's unique
      responsibility.

## PR Checklist

When opening a PR that adds or modifies e2e specs:

- [ ] Verified that no other spec file already covers the same flow
- [ ] Each spec file uses a self-contained set of route mocks (no cross-file
      mock dependencies)
- [ ] Updated the responsibility table in this README if a spec was added,
      removed, or re-scoped
- [ ] Tests pass locally with `npx playwright test --project=chromium`
