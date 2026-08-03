# Webhook Integration Guide

RemitLend can deliver real-time event notifications to external services via
webhooks. This guide covers everything an external integrator needs to
subscribe, receive, and verify webhook deliveries.

---

## Table of Contents

- [Creating a Subscription](#creating-a-subscription)
- [Supported Event Types](#supported-event-types)
- [Payload Examples](#payload-examples)
- [Delivery & Retry Semantics](#delivery--retry-semantics)
- [Circuit Breaker](#circuit-breaker)
- [Verifying HMAC Signatures](#verifying-hmac-signatures)
- [Subscriber Response Requirements](#subscriber-response-requirements)

---

## Creating a Subscription

**Endpoint:** `POST /api/webhooks/subscriptions`

**Headers:**
```
Content-Type: application/json
Authorization: Bearer <your-jwt-token>
```

**Request body:**

```json
{
  "url": "https://your-service.com/webhooks/remitlend",
  "events": ["LoanApproved", "LoanRepaid", "LoanDefaulted"],
  "description": "My loan tracking service (optional)"
}
```

| Field       | Type     | Description                                          |
|-------------|----------|------------------------------------------------------|
| `url`       | string   | HTTPS endpoint that will receive POST requests       |
| `events`    | string[] | Array of [event types](#supported-event-types)       |
| `description` | string | Optional human-readable label                      |

**Response (201):**

```json
{
  "success": true,
  "data": {
    "id": "sub_abc123",
    "url": "https://your-service.com/webhooks/remitlend",
    "events": ["LoanApproved", "LoanRepaid", "LoanDefaulted"],
    "active": true,
    "createdAt": "2026-05-28T12:00:00.000Z"
  }
}
```

After creation the subscription is immediately active. No verification handshake
is required.

### Managing Subscriptions

| Method | Endpoint                              | Description            |
|--------|---------------------------------------|------------------------|
| GET    | `/api/webhooks/subscriptions`         | List all subscriptions |
| GET    | `/api/webhooks/subscriptions/:id`     | Get a single subscription |
| PUT    | `/api/webhooks/subscriptions/:id`     | Update events / URL    |
| DELETE | `/api/webhooks/subscriptions/:id`     | Delete a subscription  |

---

## Supported Event Types

The events below are what the webhook *subscription* system
(`backend/src/services/webhookService.ts`) can actually dispatch — its
`SUPPORTED_WEBHOOK_EVENT_TYPES` list is the source of truth. These are raw
Soroban contract event names, distinct from the friendly, snake_case
notification types (`loan_approved`, `repayment_due`, etc.) used by the
in-app `/api/notifications` REST API — the two are separate systems.

| Event                     | Description                                              |
|----------------------------|-----------------------------------------------------------|
| `LoanRequested`            | A borrower requested a new loan                           |
| `LoanApproved`             | A borrower's loan has been approved                       |
| `LoanRepaid`               | A repayment was received and confirmed                    |
| `LoanDefaulted`            | A loan has been marked as defaulted                        |
| `CollateralLiquidated`     | Collateral has been liquidated after default               |
| `CollateralReturned`       | Collateral was returned to the borrower                    |
| `CollateralDeposited`      | Collateral was deposited against a loan                     |
| `CollateralReleased`       | Collateral was released back to the borrower                |
| `LateFeeCharged`           | A late fee was charged on an overdue loan                   |
| `LoanExtended`             | A loan's term was extended                                  |
| `LoanCancelled`            | A loan request was cancelled                                |
| `LoanRejected`             | A loan request was rejected                                 |
| `LoanRefinanced`           | A loan was refinanced                                       |
| `InterestRateUpdated`      | The interest rate configuration changed                      |
| `DefaultTermUpdated`       | The default-term configuration changed                        |
| `TermLimitsUpdated`        | Loan term limits configuration changed                        |
| `LateFeeRateUpdated`       | The late-fee rate configuration changed                        |
| `GracePeriodUpdated`       | The grace-period configuration changed                        |
| `DefaultWindowUpdated`     | The default-window configuration changed                       |
| `MaxLoanAmountUpdated`     | The maximum loan amount configuration changed                   |
| `MinRepaymentUpdated`      | The minimum repayment configuration changed                      |
| `MaxLoansPerBorrower`      | The max-loans-per-borrower configuration changed                  |
| `MinRateBpsUpdated`        | The minimum interest rate (bps) configuration changed              |
| `MaxRateBpsUpdated`        | The maximum interest rate (bps) configuration changed               |
| `RateOracleUpdated`        | The rate oracle configuration changed                                |
| `MinScoreUpdated`          | The minimum credit score configuration changed                        |
| `Deposit`                  | A pool deposit occurred                                                |
| `Withdraw`                 | A pool withdrawal occurred                                              |
| `YieldDistributed`         | Yield was distributed to pool depositors                                  |
| `EmergencyWithdraw`        | An emergency withdrawal occurred                                            |
| `DepositCapUpdated`        | The pool deposit cap configuration changed                                    |
| `WithdrawalCooldownUpdated`| The withdrawal cooldown configuration changed                                   |
| `NFTMinted`                | A borrower/score NFT was minted                                                  |
| `ScoreUpdated`             | A borrower's credit score changed                                                  |
| `NFTSeized`                | A borrower/score NFT was seized                                                     |
| `NFTBurned`                | A borrower/score NFT was burned                                                       |
| `ProposalCreated`          | A governance proposal was created                                                       |
| `ProposalApproved`         | A governance proposal was approved                                                        |
| `ProposalFinalized`        | A governance proposal was finalized                                                          |
| `ProposalCancelled`        | A governance proposal was cancelled                                                             |
| `ColDep`                   | Collateral was deposited against a loan (short form of `CollateralDeposited`)                     |
| `ColRel`                   | Collateral was released back to the borrower (short form of `CollateralReleased`)                   |
| `LoanApprv`                | A borrower's loan has been approved (short contract event name)                                      |
| `LoanLiquidated`           | Collateral has been liquidated after default (alternate name for `CollateralLiquidated`)                |

### Legacy Aliases

Kept for backward compatibility with existing subscribers. These are
resolved to one of the current event names above by
`EVENT_TYPE_ALIASES` in `backend/src/services/eventIndexer.ts` before
dispatch, except where noted below. New integrations should prefer the
current event names listed above where an equivalent exists.

| Event             | Description                                                          |
|-------------------|------------------------------------------------------------------------|
| `Mint`            | Legacy alias — resolves to `NFTMinted`                                  |
| `AdmRemint`       | Legacy alias — resolves to `NFTMinted`                                    |
| `ScoreUpd`        | Legacy alias — resolves to `ScoreUpdated`                                   |
| `Seized`          | Legacy alias — resolves to `NFTSeized`                                        |
| `NftBurned`       | Legacy alias — resolves to `NFTBurned`                                          |
| `GovProp`         | Legacy alias — resolves to `ProposalCreated`                                      |
| `GovAppr`         | Legacy alias — resolves to `ProposalApproved`                                       |
| `GovFin`          | Legacy alias — resolves to `ProposalFinalized`                                        |
| `GovCncl`         | Legacy alias — resolves to `ProposalCancelled`                                          |
| `GovEmerg`        | Legacy alias — resolves to `ProposalCancelled`                                             |
| `GovExp`          | Legacy alias — resolves to `ProposalCancelled`                                               |
| `ScoreDecr`       | Legacy event type for a score decrease — not currently aliased to another event type            |
| `HashUpd`         | Legacy event type for a content-hash update — not currently aliased to another event type          |
| `Transfer`        | Legacy event type for an NFT/asset transfer — not currently aliased to another event type            |
| `MntAuth`         | Legacy event type for a minting-authority change — not currently aliased to another event type         |
| `MntRev`          | Legacy event type for a minting-authority revocation — not currently aliased to another event type       |
| `Paused`          | Legacy event type for a contract pause — not currently aliased to another event type                       |
| `Unpaused`        | Legacy event type for a contract unpause — not currently aliased to another event type                       |
| `PoolPaused`      | Legacy event type for a pool pause — not currently aliased to another event type                                |
| `PoolUnpaused`    | Legacy event type for a pool unpause — not currently aliased to another event type                                |

---

## Payload Examples

Every delivery is a JSON POST with the following envelope:

```json
{
  "event": "<event_type>",
  "id": "<unique_delivery_id>",
  "timestamp": "2026-05-28T12:00:00.000Z",
  "data": { }
}
```

### `LoanApproved`

```json
{
  "event": "LoanApproved",
  "id": "evt_loan_42",
  "timestamp": "2026-05-28T12:00:00.000Z",
  "data": {
    "loanId": 42,
    "borrower": "GABCDEF...",
    "amount": "5000",
    "termMonths": 12
  }
}
```

### `LoanRepaid`

```json
{
  "event": "LoanRepaid",
  "id": "evt_repay_99",
  "timestamp": "2026-05-28T12:05:00.000Z",
  "data": {
    "loanId": 42,
    "borrower": "GABCDEF...",
    "amount": "450",
    "txHash": "a1b2c3d4..."
  }
}
```

### `LoanDefaulted`

```json
{
  "event": "LoanDefaulted",
  "id": "evt_default_7",
  "timestamp": "2026-05-28T12:10:00.000Z",
  "data": {
    "loanId": 42,
    "borrower": "GABCDEF...",
    "outstandingAmount": "3200"
  }
}
```

### `CollateralLiquidated`

```json
{
  "event": "CollateralLiquidated",
  "id": "evt_liq_3",
  "timestamp": "2026-05-28T12:15:00.000Z",
  "data": {
    "loanId": 42,
    "borrower": "GABCDEF...",
    "collateralSeized": true,
    "borrowerRefund": "150"
  }
}
```

### `LateFeeCharged`

```json
{
  "event": "LateFeeCharged",
  "id": "evt_due_21",
  "timestamp": "2026-05-28T12:00:00.000Z",
  "data": {
    "loanId": 42,
    "borrower": "GABCDEF...",
    "dueDate": "2026-06-01",
    "amount": "450"
  }
}
```

### `ScoreUpdated`

```json
{
  "event": "ScoreUpdated",
  "id": "evt_score_15",
  "timestamp": "2026-05-28T12:00:00.000Z",
  "data": {
    "userId": "GABCDEF...",
    "previousScore": 650,
    "newScore": 665,
    "reason": "on-time repayment"
  }
}
```

---

## Delivery & Retry Semantics

1. **Delivery method:** HTTP POST to the subscriber URL.
2. **Timeout:** The endpoint must respond within **10 seconds**.
3. **Retry policy:** Deliveries are retried with exponential backoff:
   - Retry 1: 10 seconds
   - Retry 2: 30 seconds
   - Retry 3: 1 minute
   - Retry 4: 5 minutes
   - Retry 5: 15 minutes
   - Retry 6: 30 minutes
   - Retry 7: 1 hour
4. **Max attempts:** 8 total (1 initial + 7 retries).
5. **Delivery window:** Events older than **24 hours** are not retried.
6. **Ordering:** Webhooks are delivered on a **best-effort** basis and may not
   arrive in the exact order events occurred.

---

## Circuit Breaker

If a subscriber endpoint fails to respond with a 2xx status for **5 consecutive
deliveries**, the subscription is automatically **deactivated** to avoid
wasting resources.

While deactivated:
- No further events are sent to the subscriber.
- The subscription status changes to `deactivated`.
- You can **re-activate** the subscription by calling
  `PUT /api/webhooks/subscriptions/:id` with `{ "active": true }`.

---

## Verifying HMAC Signatures

Each delivery includes an `X-RemitLend-Signature` header containing an
HMAC-SHA256 signature of the **raw request body**.

**Header format:**
```
X-RemitLend-Signature: sha256=<hex-encoded-hmac>
```

The value is `sha256=` followed by the lowercase hex-encoded HMAC-SHA256
digest computed over the raw request body (no timestamp prefix).

### Verification snippet (Node.js)

```typescript
import { createHmac, timingSafeEqual } from "node:crypto";

function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
): boolean {
  const expected =
    "sha256=" +
    createHmac("sha256", secret).update(rawBody).digest("hex");

  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader ?? "");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
```

> ⚠️ **Important:** Always use `timingSafeEqual` (or your language's
> constant-time comparison) when verifying the signature to prevent timing
> attacks.

### Obtaining your secret

The signing secret is the **per-subscription secret** returned in the
response when you register the webhook subscription (see
[Creating a Subscription](#creating-a-subscription)). It is **not** a
global environment variable. Store it securely on your server and use it
to verify each incoming delivery.

See also: [docs/wiki/webhook-signatures.md](wiki/webhook-signatures.md)
for additional language examples.

---

## Subscriber Response Requirements

| Code    | Meaning                                      |
|---------|----------------------------------------------|
| 2xx     | Delivery accepted — no retry                 |
| 4xx     | Request rejected — permanent failure (no retry) |
| 5xx     | Server error — will be retried               |
| Timeout | Treated as a failure — will be retried       |

- **Respond within 10 seconds.** Slow responses are counted as failures.
- Returning any 2xx status (200, 201, 202, 204) acknowledges delivery.

---

## Need Help?

Contact the RemitLend team or open an issue on GitHub for integration support.
