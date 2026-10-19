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

**Endpoint:** `POST /api/indexer/webhooks` *(also available at `POST /api/v1/indexer/webhooks` and `POST /api/admin/webhooks`)*

**Headers:**
```
Content-Type: application/json
x-api-key: <your-admin-api-key>
```

*(Requires `admin:webhooks` API key scope)*

**Request body:**

```json
{
  "callbackUrl": "https://your-service.com/webhooks/remitlend",
  "eventTypes": ["LoanApproved", "LoanRepaid", "LoanDefaulted"],
  "secret": "your-hmac-secret-key"
}
```

| Field         | Type     | Required | Description                                                                      |
|---------------|----------|----------|----------------------------------------------------------------------------------|
| `callbackUrl` | string   | Yes      | HTTP or HTTPS endpoint that will receive POST deliveries (private IPs rejected)  |
| `eventTypes`  | string[] | Yes      | Array of [event types](#supported-event-types) to subscribe to                   |
| `secret`      | string   | No       | Optional secret key used to sign webhook payloads using HMAC-SHA256              |

**Response (201):**

```json
{
  "success": true,
  "data": {
    "subscription": {
      "id": 1,
      "callbackUrl": "https://your-service.com/webhooks/remitlend",
      "eventTypes": ["LoanApproved", "LoanRepaid", "LoanDefaulted"],
      "isActive": true,
      "createdAt": "2026-05-28T12:00:00.000Z",
      "updatedAt": "2026-05-28T12:00:00.000Z"
    }
  }
}
```

After creation the subscription is immediately active. No verification handshake
is required.

### Managing Subscriptions

| Method | Endpoint                                | Description                                     |
|--------|-----------------------------------------|-------------------------------------------------|
| GET    | `/api/indexer/webhooks`                 | List all webhook subscriptions                  |
| POST   | `/api/indexer/webhooks`                 | Register a new webhook subscription             |
| DELETE | `/api/indexer/webhooks/:subscriptionId` | Delete a webhook subscription                   |
| GET    | `/api/admin/webhooks/:id/deliveries`    | View delivery history for a subscription        |
| GET    | `/api/admin/webhooks/retry-status`      | View failed webhooks and retry queue status     |

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

Every delivery is a JSON POST with a flat structure containing event metadata and indexed contract attributes:

```json
{
  "eventId": "<unique_event_id>",
  "eventType": "<event_type>",
  "loanId": 42,
  "address": "<stellar_account_address>",
  "amount": "<stroop_amount>",
  "interestRateBps": 500,
  "termLedgers": 17280,
  "ledger": 12345,
  "ledgerClosedAt": "2026-05-28T12:00:00.000Z",
  "txHash": "<transaction_hash>",
  "contractId": "<contract_address>",
  "topics": ["<topic1>", "<topic2>"],
  "value": "<scval_value>"
}
```

### `LoanApproved`

```json
{
  "eventId": "12345:0",
  "eventType": "LoanApproved",
  "loanId": 42,
  "address": "GABCDEF...",
  "amount": "5000000000",
  "interestRateBps": 500,
  "termLedgers": 17280,
  "ledger": 12345,
  "ledgerClosedAt": "2026-05-28T12:00:00.000Z",
  "txHash": "a1b2c3d4...",
  "contractId": "CA...",
  "topics": ["LoanApproved", "42"],
  "value": "..."
}
```

### `LoanRepaid`

```json
{
  "eventId": "12346:1",
  "eventType": "LoanRepaid",
  "loanId": 42,
  "address": "GABCDEF...",
  "amount": "450000000",
  "ledger": 12346,
  "ledgerClosedAt": "2026-05-28T12:05:00.000Z",
  "txHash": "b2c3d4e5...",
  "contractId": "CA...",
  "topics": ["LoanRepaid", "42"],
  "value": "..."
}
```

### `LoanDefaulted`

```json
{
  "eventId": "12347:0",
  "eventType": "LoanDefaulted",
  "loanId": 42,
  "address": "GABCDEF...",
  "amount": "3200000000",
  "ledger": 12347,
  "ledgerClosedAt": "2026-05-28T12:10:00.000Z",
  "txHash": "c3d4e5f6...",
  "contractId": "CA...",
  "topics": ["LoanDefaulted", "42"],
  "value": "..."
}
```

### `CollateralLiquidated`

```json
{
  "eventId": "12348:2",
  "eventType": "CollateralLiquidated",
  "loanId": 42,
  "address": "GABCDEF...",
  "amount": "1500000000",
  "ledger": 12348,
  "ledgerClosedAt": "2026-05-28T12:15:00.000Z",
  "txHash": "d4e5f6a7...",
  "contractId": "CA...",
  "topics": ["CollateralLiquidated", "42"],
  "value": "..."
}
```

### `LateFeeCharged`

```json
{
  "eventId": "12349:0",
  "eventType": "LateFeeCharged",
  "loanId": 42,
  "address": "GABCDEF...",
  "amount": "45000000",
  "ledger": 12349,
  "ledgerClosedAt": "2026-05-28T12:20:00.000Z",
  "txHash": "e5f6a7b8...",
  "contractId": "CA...",
  "topics": ["LateFeeCharged", "42"],
  "value": "..."
}
```

### `ScoreUpdated`

```json
{
  "eventId": "12350:1",
  "eventType": "ScoreUpdated",
  "address": "GABCDEF...",
  "amount": "665",
  "ledger": 12350,
  "ledgerClosedAt": "2026-05-28T12:25:00.000Z",
  "txHash": "f6a7b8c9...",
  "contractId": "CA...",
  "topics": ["ScoreUpdated", "GABCDEF..."],
  "value": "..."
}
```

---

## Delivery & Retry Semantics

1. **Delivery method:** HTTP POST to the subscriber `callbackUrl` with `Content-Type: application/json`.
2. **Timeout:** The endpoint must respond within **30 seconds** (`WEBHOOK_REQUEST_TIMEOUT_MS`, default 30s).
3. **Retry policy:** Deliveries that fail (network error, timeout, or HTTP non-2xx status) are queued in `webhook_deliveries` and retried by the background retry processor with the following schedule:
   - Initial attempt: immediate
   - Retry 1: ~5 minutes after failure (`RETRY_DELAYS_MS[0]`)
   - Retry 2: ~15 minutes after failure (`RETRY_DELAYS_MS[1]`)
   - Retry 3: ~45 minutes after failure (`RETRY_DELAYS_MS[2]`)
4. **Max attempts:** 4 total attempts (`MAX_RETRY_ATTEMPTS = 4`). After attempt 4, the delivery is marked as permanently failed.
5. **Ordering:** Webhooks are delivered on a **best-effort** basis and may not arrive in the exact order events occurred.

---

## Circuit Breaker

If a subscriber endpoint fails to respond with a 2xx status for **5 consecutive
deliveries**, the subscription is automatically **deactivated** to avoid
wasting resources.

While deactivated:
- No further events are sent to the subscriber.
- The subscription status changes to `deactivated` (`isActive: false`).
- You can register a new subscription or contact the administrator to re-enable it.

---

## Verifying HMAC Signatures

Deliveries with a configured subscription secret include an
`X-RemitLend-Signature` header in this format:

```
X-RemitLend-Signature: t=<unix-seconds>,v1=<hex-encoded-hmac>
```

The HMAC-SHA256 digest covers `${timestamp}.${rawBody}`. Reject timestamps
outside a short tolerance window (five minutes is recommended), then compare
the digest in constant time. Retries get a fresh timestamp and signature.

```typescript
import { createHmac, timingSafeEqual } from "node:crypto";

function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
  now = Date.now(),
): boolean {
  const match = /^t=(\d+),v1=([a-f0-9]{64})$/.exec(signatureHeader ?? "");
  if (!match) return false;
  const [, timestamp, signature] = match;
  const timestampMs = Number(timestamp) * 1000;
  if (!Number.isSafeInteger(timestampMs) || Math.abs(now - timestampMs) > 5 * 60_000) {
    return false;
  }
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest();
  const received = Buffer.from(signature, "hex");
  return received.length === expected.length && timingSafeEqual(expected, received);
}
```

Capture the raw body and verify before JSON decoding. The signing secret is the
per-subscription secret returned when registering the webhook. See
[the full signature guide](wiki/webhook-signatures.md) for Python and Express examples.

---

## Subscriber Response Requirements

| Code    | Meaning                                      |
|---------|----------------------------------------------|
| 2xx     | Delivery accepted — no retry                 |
| 4xx     | Request rejected — permanent failure (no retry) |
| 5xx     | Server error — will be retried               |
| Timeout | Treated as a failure — will be retried       |

- **Respond within 30 seconds.** Slow responses exceeding the timeout are counted as failures.
- Returning any 2xx status (200, 201, 202, 204) acknowledges delivery.

---

## Need Help?

Contact the RemitLend team or open an issue on GitHub for integration support.
