# Database Schema Reference

This document describes every table created by the 33 migrations in `backend/migrations/`,
their columns, indexes, and relationships.

---

## Table: `scores`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `serial` | `PRIMARY KEY` | |
| `user_id` | `varchar(255)` | `NOT NULL, UNIQUE` | Historical name; renamed `borrower` in ensure-core-tables migration |
| `current_score` | `integer` | `NOT NULL, DEFAULT 500` | Historical name; renamed `score` in ensure-core-tables migration. Clamped 300-850 |
| `created_at` | `timestamp` | `DEFAULT CURRENT_TIMESTAMP` | Added by migration 1774000000004 |
| `updated_at` | `timestamp` | `DEFAULT CURRENT_TIMESTAMP` | |

**Indexes**: unique on `user_id`.

**Notes**: The column names differ across environments depending on which migrations
have run. The `ensure-core-tables` migration (1789000000000) renames `user_id -> borrower`
and `current_score -> score` if the old names still exist. Code that queries this table
at runtime uses the CURRENT column names (see `scoresService.ts`).

---

## Table: `contract_events` (originally `loan_events`)

Renamed from `loan_events` by migration 1788000000018. A backward-compat view named
`loan_events` is also created, mapping `address AS borrower`.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `serial` | `PRIMARY KEY` | |
| `event_id` | `varchar(255)` | `NOT NULL, UNIQUE` | Soroban event ID from RPC |
| `event_type` | `varchar(50)` | `NOT NULL` | e.g. `LoanRequested`, `LoanApproved`, `LoanRepaid`, `Deposit` |
| `loan_id` | `integer` | | NULL for non-loan events (e.g. governance, pool) |
| `address` | `varchar(255)` | | Renamed from `borrower`; nullable for events without a user address |
| `amount` | `numeric` | | |
| `ledger` | `integer` | `NOT NULL` | Stellar ledger sequence number |
| `ledger_closed_at` | `timestamp` | `NOT NULL` | |
| `tx_hash` | `varchar(255)` | `NOT NULL` | |
| `contract_id` | `varchar(255)` | `NOT NULL` | |
| `topics` | `jsonb` | | Raw XDR topics as base64 |
| `value` | `text` | | Raw XDR value as base64 |
| `interest_rate_bps` | `integer` | | Added by migration 1776000000006 |
| `term_ledgers` | `integer` | | Added by migration 1776000000006 |
| `created_at` | `timestamp` | `DEFAULT CURRENT_TIMESTAMP` | |

**Indexes**:
- `contract_events_event_type_index` on `event_type`
- `contract_events_address_index` on `address`
- `contract_events_loan_id_index` on `loan_id`
- `contract_events_ledger_index` on `ledger`
- `contract_events_tx_hash_index` on `tx_hash`
- `idx_contract_events_address_type_closed_at` on `(address, event_type, ledger_closed_at)` WHERE `address IS NOT NULL`
- `idx_contract_events_address_event_type` (renamed from `idx_loan_events_borrower_event_type`)
- `idx_contract_events_loan_id_event_type` (renamed from `idx_loan_events_loan_id_event_type`)
- `idx_contract_events_event_type_loan_id` (renamed from `idx_loan_events_event_type_loan_id`)
- `idx_contract_events_pool_deposits_withdraws` (renamed from `idx_loan_events_pool_deposits_withdraws`)
- `uq_contract_events_loan_type_ledger` — UNIQUE on `(loan_id, event_type, ledger)` (added by migration 1789000000001)
- `loan_events_unique_approved_event_per_loan` — UNIQUE partial index on `loan_id` WHERE `event_type = 'LoanApproved'`
- `idx_loan_events_type_created_at` on `(event_type, created_at)` (on the `loan_events` view)

**View**: `loan_events` — SELECT from `contract_events` with `address AS borrower`.

---

## Table: `indexer_state`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `serial` | `PRIMARY KEY` | |
| `last_indexed_ledger` | `integer` | `NOT NULL, DEFAULT 0` | Renamed to `last_ledger` in ensure-core-tables migration |
| `last_indexed_cursor` | `varchar(255)` | | |
| `contract` | `varchar(255)` | `NOT NULL, UNIQUE` | Added by ensure-core-tables; default `'default'` |
| `updated_at` | `timestamp` | `DEFAULT CURRENT_TIMESTAMP` | |

**Notes**: Tracks the last ledger block the event indexer has processed. Row is
inserted on first run (value 0).

---

## Table: `remittance_history`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `serial` | `PRIMARY KEY` | |
| `user_id` | `varchar(255)` | `NOT NULL` | |
| `amount` | `numeric` | `NOT NULL` | |
| `month` | `varchar(50)` | `NOT NULL` | e.g. `2024-01` |
| `status` | `varchar(50)` | `NOT NULL` | |
| `created_at` | `timestamp` | `DEFAULT CURRENT_TIMESTAMP` | |

**Indexes**: on `user_id`.

---

## Table: `remittances`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | `PRIMARY KEY, DEFAULT gen_random_uuid()` | |
| `sender_id` | `varchar(56)` | `NOT NULL` | Stellar public key |
| `recipient_address` | `varchar(56)` | `NOT NULL` | |
| `amount` | `numeric(20,7)` | `NOT NULL` | |
| `from_currency` | `varchar(10)` | `NOT NULL` | |
| `to_currency` | `varchar(10)` | `NOT NULL` | |
| `memo` | `varchar(28)` | | |
| `status` | `varchar(20)` | `NOT NULL, DEFAULT 'pending'` | CHECK IN (`pending`, `processing`, `completed`, `failed`) |
| `transaction_hash` | `varchar(64)` | | |
| `xdr` | `text` | `NOT NULL` | Stellar transaction envelope XDR |
| `error_message` | `text` | | |
| `created_at` | `timestamp` | `DEFAULT CURRENT_TIMESTAMP` | |
| `updated_at` | `timestamp` | `DEFAULT CURRENT_TIMESTAMP` | |

**Indexes**:
- `remittances_sender_id_index` on `sender_id`
- `remittances_sender_id_status_index` on `(sender_id, status)`
- `remittances_created_at_index` on `created_at`
- `remittances_transaction_hash_index` on `transaction_hash`
- `idx_remittances_sender_status_created` on `(sender_id, status, created_at)`
- `idx_remittances_sender_created` on `(sender_id, created_at)`

---

## Table: `webhook_subscriptions`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `serial` | `PRIMARY KEY` | |
| `callback_url` | `text` | `NOT NULL` | |
| `event_types` | `jsonb` | `NOT NULL, DEFAULT '[]'` | Array of event type strings to subscribe to |
| `secret` | `varchar(255)` | | HMAC secret for webhook payload signing |
| `is_active` | `boolean` | `NOT NULL, DEFAULT true` | |
| `max_attempts` | `integer` | `NOT NULL, DEFAULT 5` | Added by migration 1786000000016 |
| `created_at` | `timestamp` | `DEFAULT CURRENT_TIMESTAMP` | |
| `updated_at` | `timestamp` | `DEFAULT CURRENT_TIMESTAMP` | |

**Indexes**: on `is_active`.

---

## Table: `webhook_deliveries`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `serial` | `PRIMARY KEY` | |
| `subscription_id` | `integer` | `NOT NULL, REFERENCES webhook_subscriptions ON DELETE CASCADE` | |
| `event_id` | `varchar(255)` | `NOT NULL` | |
| `event_type` | `varchar(50)` | `NOT NULL` | |
| `payload` | `jsonb` | `NOT NULL` | Added by migration 1781000000011 |
| `attempt_count` | `integer` | `NOT NULL, DEFAULT 0` | |
| `last_status_code` | `integer` | | HTTP status code from last delivery attempt |
| `last_error` | `text` | | |
| `delivered_at` | `timestamp` | | Set when delivery succeeds |
| `next_retry_at` | `timestamp` | | Added by migration 1781000000011; NULL when delivered |
| `created_at` | `timestamp` | `DEFAULT CURRENT_TIMESTAMP` | |
| `updated_at` | `timestamp` | `DEFAULT CURRENT_TIMESTAMP` | |

**Indexes**:
- `webhook_deliveries_event_id_index` on `event_id`
- `webhook_deliveries_subscription_id_index` on `subscription_id`
- `webhook_deliveries_next_retry_at_delivered_at_index` on `(next_retry_at, delivered_at)`
- on `(next_retry_at)` WHERE `next_retry_at IS NOT NULL AND delivered_at IS NULL`
- on `(subscription_id, event_id)`

---

## Table: `user_profiles`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `serial` | `PRIMARY KEY` | |
| `public_key` | `varchar(255)` | `NOT NULL, UNIQUE` | Stellar wallet public key |
| `display_name` | `varchar(255)` | | |
| `email` | `varchar(255)` | | |
| `phone` | `varchar(50)` | | Added by migration 1787000000017 |
| `email_enabled` | `boolean` | `NOT NULL, DEFAULT true` | Initially in migration 1773000000001; added again by 1787000000017 |
| `sms_enabled` | `boolean` | `NOT NULL, DEFAULT true` | Initially in migration 1773000000001; added again by 1787000000017 |
| `metadata` | `jsonb` | | |
| `created_at` | `timestamp` | `DEFAULT CURRENT_TIMESTAMP` | |
| `updated_at` | `timestamp` | `DEFAULT CURRENT_TIMESTAMP` | |

**Indexes**: on `public_key`.

---

## Table: `loan_history`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `serial` | `PRIMARY KEY` | |
| `loan_id` | `integer` | `NOT NULL` | |
| `borrower_public_key` | `varchar(255)` | `NOT NULL` | |
| `lender_public_key` | `varchar(255)` | | |
| `principal_amount` | `numeric` | `NOT NULL` | |
| `interest_rate_bps` | `integer` | `NOT NULL` | In basis points |
| `principal_paid` | `numeric` | `DEFAULT 0` | |
| `interest_paid` | `numeric` | `DEFAULT 0` | |
| `accrued_interest` | `numeric` | `DEFAULT 0` | |
| `status` | `varchar(50)` | `NOT NULL` | |
| `due_date` | `timestamp` | | |
| `requested_at` | `timestamp` | | |
| `approved_at` | `timestamp` | | |
| `repaid_at` | `timestamp` | | |
| `defaulted_at` | `timestamp` | | |
| `metadata` | `jsonb` | | |
| `created_at` | `timestamp` | `DEFAULT CURRENT_TIMESTAMP` | |
| `updated_at` | `timestamp` | `DEFAULT CURRENT_TIMESTAMP` | |

**Indexes**: on `loan_id`, `borrower_public_key`, `lender_public_key`, `status`.

---

## Table: `indexed_events`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `serial` | `PRIMARY KEY` | |
| `event_id` | `varchar(255)` | `NOT NULL, UNIQUE` | |
| `event_type` | `varchar(50)` | `NOT NULL` | |
| `contract_id` | `varchar(255)` | `NOT NULL` | |
| `tx_hash` | `varchar(255)` | `NOT NULL` | |
| `ledger` | `integer` | `NOT NULL` | |
| `ledger_closed_at` | `timestamp` | `NOT NULL` | |
| `topics` | `jsonb` | | |
| `value` | `text` | | |
| `processed` | `boolean` | `NOT NULL, DEFAULT false` | |
| `created_at` | `timestamp` | `DEFAULT CURRENT_TIMESTAMP` | |
| `updated_at` | `timestamp` | `DEFAULT CURRENT_TIMESTAMP` | |

**Indexes**: on `event_type`, `contract_id`, `ledger`, `tx_hash`, `processed`.

---

## Table: `notifications`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `serial` | `PRIMARY KEY` | |
| `user_id` | `varchar(255)` | `NOT NULL` | |
| `type` | `varchar(50)` | `NOT NULL` | e.g. `loan_approved`, `repayment_due`, `repayment_confirmed`, `loan_defaulted`, `score_changed` |
| `title` | `varchar(255)` | `NOT NULL` | |
| `message` | `text` | `NOT NULL` | |
| `loan_id` | `integer` | | |
| `read` | `boolean` | `NOT NULL, DEFAULT false` | Legacy; superseded by `status` |
| `status` | `varchar(20)` | `NOT NULL, DEFAULT 'unread'` | Added by migration 1783000000013; CHECK IN (`unread`, `read`, `archived`) |
| `action_url` | `varchar(500)` | | Added by migration 1794000000000; deep-link URL |
| `created_at` | `timestamp` | `DEFAULT CURRENT_TIMESTAMP` | |

**Indexes**:
- `notifications_user_id_index` on `user_id`
- `notifications_read_index` on `read`
- `notifications_user_id_read_index` on `(user_id, read)`
- `notifications_created_at_index` on `created_at`
- `notifications_status_index` on `status`
- `idx_notifications_status_created_at` on `(status, created_at)`
- `idx_notifications_user_type_status_created` on `(user_id, type, status, created_at)`
- `idx_notifications_user_created` on `(user_id, created_at)`

---

## Table: `quarantine_events`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `serial` | `PRIMARY KEY` | |
| `event_id` | `varchar(255)` | `NOT NULL, UNIQUE` | |
| `ledger` | `integer` | `NOT NULL` | |
| `tx_hash` | `varchar(255)` | `NOT NULL` | |
| `contract_id` | `varchar(255)` | `NOT NULL` | |
| `raw_xdr` | `jsonb` | `NOT NULL` | Full event payload as base64-encoded XDR |
| `error_message` | `text` | `NOT NULL` | Why parsing failed |
| `quarantined_at` | `timestamp` | `DEFAULT CURRENT_TIMESTAMP` | |

**Indexes**: on `ledger`, `quarantined_at`.

---

## Table: `transaction_submissions`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `serial` | `PRIMARY KEY` | |
| `tx_hash` | `varchar(64)` | `NOT NULL, UNIQUE` | |
| `status` | `varchar(50)` | `NOT NULL` | |
| `submitted_at` | `timestamp with time zone` | `NOT NULL, DEFAULT NOW()` | |
| `submitted_by` | `varchar(56)` | | Stellar public key of submitter |
| `transaction_type` | `varchar(20)` | `NOT NULL, DEFAULT 'loan'` | |
| `result_xdr` | `text` | | Result XDR from transaction |
| `created_at` | `timestamp with time zone` | `DEFAULT NOW()` | |
| `updated_at` | `timestamp with time zone` | `DEFAULT NOW()` | Auto-updated by trigger |

**Indexes**: on `submitted_at`, `submitted_by`, `status`, `transaction_type`.

---

## Table: `audit_logs`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `serial` | `PRIMARY KEY` | |
| `actor` | `varchar(255)` | `NOT NULL` | Admin address or `SYSTEM` |
| `action` | `varchar(255)` | `NOT NULL` | e.g. `ADMIN_CONFIG_*`, `loan_approved` |
| `target` | `varchar(255)` | | e.g. `contract:0x...`, `loan:42` |
| `payload` | `jsonb` | | Structured event details |
| `ip_address` | `varchar(50)` | | HTTP request IP (null for on-chain actions) |
| `created_at` | `timestamp` | `DEFAULT CURRENT_TIMESTAMP` | |

**Indexes**: on `actor`, `action`, `created_at`.

---

## Table: `loan_disputes`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `serial` | `PRIMARY KEY` | |
| `loan_id` | `integer` | `NOT NULL, REFERENCES loan_events(loan_id)` | |
| `borrower` | `text` | `NOT NULL` | |
| `reason` | `text` | `NOT NULL` | |
| `status` | `text` | `NOT NULL, DEFAULT 'open'` | `open`, `resolved`, `rejected` |
| `admin_note` | `text` | | |
| `resolution` | `text` | | |
| `created_at` | `timestamp with time zone` | `DEFAULT NOW()` | |
| `resolved_at` | `timestamp with time zone` | | |

**Indexes**: on `status`, `borrower`, `loan_id`.

---

## Table: `user_notification_preferences`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `user_id` | `varchar(255)` | `PRIMARY KEY` | |
| `digest_frequency` | `varchar(20)` | `NOT NULL, DEFAULT 'off'` | Added by migration 1793000000000; CHECK IN (`off`, `daily`, `weekly`) |

**Notes**: Originally seeded as notification preference fields on `user_profiles`.
This table stores per-user digest frequency settings independently.

---

## Entity Relationships

```
scores (1:1 with address) ──> user identified by user_id/borrower
contract_events (many per loan) ──> referenced by loan_id
remittances (many per sender) ──> sender_id
notifications (many per user) ──> user_id
webhook_deliveries (many per subscription) ──> subscription_id -> webhook_subscriptions
loan_disputes (1:1 per disputed loan) ──> loan_id -> contract_events(loan_id)
user_profiles (1:1 per address) ──> public_key
```

### Event Flow
```
Stellar Soroban contract emits event
  -> indexer polls Stellar RPC
    -> stored in contract_events
      -> scores updated (score deltas applied)
        -> webhooks dispatched
          -> SSE broadcast to connected clients
            -> notifications created for users
```

### Historical Renames

| Old Name | Current Name | Migration |
|---|---|---|
| `loan_events` (table) | `contract_events` | 1788000000018 |
| `loan_events` (backward-compat view) | `loan_events` (view) | 1788000000018 |
| `borrower` column | `address` | 1788000000018 |
| `user_id` column (scores) | `borrower` | 1789000000000 |
| `current_score` column (scores) | `score` | 1789000000000 |
| `last_indexed_ledger` (indexer_state) | `last_ledger` | 1789000000000 |
