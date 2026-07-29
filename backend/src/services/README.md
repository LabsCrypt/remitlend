# Services

## Overview

The `services/` layer contains the core business logic of the RemitLend backend. Each service encapsulates a specific domain concern and provides a clean interface for controllers, middleware, and background jobs. Services handle database access, external API calls (blockchain, cache), and stateful operations like webhook retries and score reconciliation.

### Services Index

| Service                        | Responsibility                                                              | Key Entry Points                                                                                      |
| ------------------------------ | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **authService**                | JWT generation/verification, signature validation, challenge flow           | `generateChallenge()`, `verifySignature()`, `generateJwtToken()`, `verifyJwtToken()`, `revokeToken()` |
| **cacheService**               | Redis wrapper for key-value caching                                         | `get()`, `set()`, `delete()`, `setNotExists()`                                                        |
| **databaseService**            | User profiles, loan history, indexed events CRUD                            | `UserProfileService.*`, `LoanHistoryService.*`, `IndexedEventsService.*`                              |
| **eventIndexer**               | Polls Stellar RPC for contract events, stores in PostgreSQL                 | `startIndexing()`, `stopIndexing()` (via IndexerManager)                                              |
| **indexerManager**             | Lifecycle management for the event indexer                                  | `start()`, `stop()`                                                                                   |
| **eventStreamService**         | SSE stream of loan events for frontend real-time updates                    | `getEventStream()`                                                                                    |
| **defaultChecker**             | Background scheduler that calls on-chain `check_defaults` for overdue loans | Runs automatically on interval                                                                        |
| **scoresService**              | Bulk credit score updates and reconciliation                                | `updateUserScoresBulk()`, `setAbsoluteUserScoresBulk()`                                               |
| **scoreReconciliationService** | Compares DB scores vs on-chain, auto-corrects divergence                    | Runs automatically on interval                                                                        |
| **scoreDecayService**          | Score decay logic (not currently scheduled)                                 | `applyDecay()`                                                                                        |
| **sorobanService**             | Stellar/Soroban contract interaction (read/write)                           | `getContract()`, `submitTransaction()`                                                                |
| **webhookService**             | Deliver webhooks to registered URLs with signature                          | `deliverWebhook()`, `retryFailedWebhook()`                                                            |
| **webhookRetryScheduler**      | Background scheduler for exponential backoff webhook retries                | Runs automatically every 60s                                                                          |
| **webhookRetryProcessor**      | Alternative webhook retry implementation (not currently used)               | —                                                                                                     |
| **notificationService**        | In-app notifications, digests, cleanup                                      | `createNotification()`, `sendDigest()`, cleanup runs every 24h                                        |
| **remittanceService**          | Remittance NFT operations and queries                                       | `createRemittance()`, `getRemittancesByUser()`                                                        |
| **rateLimitService**           | Track and enforce rate limits by key                                        | `checkRateLimit()`, `incrementCounter()`                                                              |
| **auditLogService**            | Record audit trail for sensitive operations                                 | `logAction()`                                                                                         |
| **jobMetricsService**          | Track success/failure metrics for background jobs                           | `recordJobRun()`, `getJobMetrics()`                                                                   |
| **yieldHistoryService**        | Query and aggregate yield data for lenders                                  | `getYieldHistory()`, `calculateAPY()`                                                                 |

### Background Schedulers

Several services run as background jobs that are started in `index.ts` when the API process launches:

- **Event Indexer**: Continuous poll (configurable via `INDEXER_POLL_INTERVAL_MS`, default 30s)
- **Default Checker**: Interval (configurable via `DEFAULT_CHECK_INTERVAL_MS`, default 30m)
- **Webhook Retry Scheduler**: Fixed 60s interval
- **Score Reconciliation**: Interval (configurable via `SCORE_RECONCILIATION_INTERVAL_MS`, default 1h)
- **Notification Cleanup**: Fixed 24h interval (retention controlled by `NOTIFICATION_RETENTION_DAYS`, `READ_NOTIFICATION_RETENTION_DAYS`)
- **Loan Due Check**: Cron `0 * * * *` (top of every hour)

See the [Background Jobs table in the original README](#background-jobs) for full details on env vars and behavior.

### Environment Variables

Services read configuration from `.env`. Key variables:

- `JWT_SECRET`: HMAC secret for JWT signing
- `REDIS_URL`: Redis connection string for caching
- `DATABASE_URL`: PostgreSQL connection string
- `STELLAR_NETWORK`, `STELLAR_RPC_URL`, `STELLAR_NETWORK_PASSPHRASE`: Blockchain config
- `LOAN_MANAGER_CONTRACT_ID`, `LENDING_POOL_CONTRACT_ID`, etc.: Contract addresses
- `INDEXER_POLL_INTERVAL_MS`, `INDEXER_BATCH_SIZE`: Event indexer tuning
- `DEFAULT_CHECK_INTERVAL_MS`: Default checker frequency
- `SCORE_RECONCILIATION_INTERVAL_MS`: Reconciliation frequency
- `NOTIFICATION_RETENTION_DAYS`, `READ_NOTIFICATION_RETENTION_DAYS`: Notification cleanup

Refer to `backend/.env.example` for the full list.

### jobMetricsService

Tracks per-background-job health: `lastRunAt`, `lastSuccessAt`, `lastError`, `runsTotal`, `failuresTotal`, and `durationMs`, keyed by job name. Jobs call `recordSuccess()`/`recordFailure()` after each run; metrics are read back via `getJobMetrics()`/`getAllMetrics()` for status endpoints and dashboards.

**Consumers**: `defaultChecker.ts`, `scoreReconciliationService.ts`, `webhookRetryProcessor.ts`, `cron/scoreDecayJob.ts`, `cron/loanCheckCron.ts`.

### rateLimitService

Redis-backed fixed-window rate limiter using atomic `INCR`+`EXPIRE` via a Lua script, keyed by an arbitrary identifier (user ID, IP, etc.). `checkRateLimit()` increments and evaluates the window; `getRateLimitStatus()` reads without incrementing; `resetRateLimit()` clears a key. Fails open (allows the request) if Redis is unreachable, so an outage never blocks traffic outright.

**Consumers**: `middleware/rateLimitMiddleware.ts` (per-route rate limiting), score update endpoints via the exported `SCORE_UPDATE_RATE_LIMIT` config.

### Testing

Most services have corresponding test files in `services/__tests__/`. Tests use Jest and mock external dependencies (database, Redis, Stellar RPC). Run:

```bash
npm test -- services/
```

### Related Documentation

- [Event Indexer deep-dive](#event-indexer-service) (below)
- [Indexer Recovery Runbook](../../docs/runbooks/indexer-recovery.md)
- [Webhooks Guide](../../docs/webhooks.md)

---

## Event Indexer Service

## Overview

The Event Indexer is a robust service that synchronizes on-chain loan events from the Stellar blockchain with the PostgreSQL database. It continuously polls the Stellar RPC server for new contract events and stores them locally for fast querying by the frontend.

## Features

- **Automatic Polling**: Continuously monitors the blockchain for new events
- **Event Deduplication**: Prevents duplicate events from being stored
- **Graceful Error Handling**: Recovers from temporary failures without data loss
- **Configurable**: Adjustable polling intervals and batch sizes
- **State Management**: Tracks the last indexed ledger to resume from interruptions
- **Multiple Event Types**: Indexes LoanRequested, LoanApproved, and LoanRepaid events

## Architecture

### Components

1. **EventIndexer** (`eventIndexer.ts`)
   - Core indexing logic
   - Polls Stellar RPC using `getEvents` method
   - Decodes XDR-encoded event data
   - Stores events in PostgreSQL

2. **IndexerManager** (`indexerManager.ts`)
   - Manages indexer lifecycle
   - Handles startup and shutdown
   - Configuration management

3. **IndexerController** (`../controllers/indexerController.ts`)
   - API endpoints for querying indexed events
   - Status monitoring

### Data Flow

```
Stellar Blockchain
       ↓
   RPC Server (getEvents)
       ↓
  Event Indexer
       ↓
   PostgreSQL
       ↓
  REST API
       ↓
   Frontend
```

## Configuration

### Environment Variables

Add these to your `.env` file:

```env
# Stellar network selection
STELLAR_NETWORK=testnet

# Optional override (defaults from STELLAR_NETWORK; must match selected network)
STELLAR_RPC_URL=https://soroban-testnet.stellar.org

# Optional override (must match selected network exactly)
STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015

# Loan Manager contract address
LOAN_MANAGER_CONTRACT_ID=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX

# How often to poll for new events (milliseconds)
INDEXER_POLL_INTERVAL_MS=30000

# Maximum events to fetch per request
INDEXER_BATCH_SIZE=100
```

### Polling Interval

The `INDEXER_POLL_INTERVAL_MS` determines how frequently the indexer checks for new events:

- **Development**: 30000ms (30 seconds) - Good balance between freshness and RPC load
- **Production**: 15000ms (15 seconds) - More responsive for users
- **Low Traffic**: 60000ms (60 seconds) - Reduces RPC costs

### Batch Size

The `INDEXER_BATCH_SIZE` controls how many events are fetched per request:

- **Default**: 100 events
- **High Volume**: Increase to 200-500 for busy contracts
- **Low Volume**: Decrease to 50 to reduce memory usage

## Database Schema

### loan_events Table

Stores all indexed loan events:

```sql
CREATE TABLE loan_events (
  id SERIAL PRIMARY KEY,
  event_id VARCHAR(255) UNIQUE NOT NULL,  -- Unique event identifier from Stellar
  event_type VARCHAR(50) NOT NULL,         -- LoanRequested, LoanApproved, LoanRepaid
  loan_id INTEGER,                         -- Loan ID (if applicable)
  borrower VARCHAR(255) NOT NULL,          -- Borrower's Stellar address
  amount NUMERIC,                          -- Loan/repayment amount
  ledger INTEGER NOT NULL,                 -- Ledger number
  ledger_closed_at TIMESTAMP NOT NULL,     -- When ledger closed
  tx_hash VARCHAR(255) NOT NULL,           -- Transaction hash
  contract_id VARCHAR(255) NOT NULL,       -- Contract that emitted event
  topics JSONB,                            -- Raw event topics
  value TEXT,                              -- Raw event value (XDR)
  created_at TIMESTAMP DEFAULT NOW()
);

-- Prevent duplicate non-repeatable status events for a single loan.
CREATE UNIQUE INDEX loan_events_unique_status_event_per_loan
ON loan_events (loan_id, event_type)
WHERE loan_id IS NOT NULL
  AND event_type IN ('LoanApproved', 'LoanDefaulted');
```

### indexer_state Table

Tracks indexer progress:

```sql
CREATE TABLE indexer_state (
  id SERIAL PRIMARY KEY,
  last_indexed_ledger INTEGER NOT NULL,    -- Last processed ledger
  last_indexed_cursor VARCHAR(255),        -- Pagination cursor
  updated_at TIMESTAMP DEFAULT NOW()
);
```

## API Endpoints

### Get Indexer Status

```http
GET /api/indexer/status
```

Returns current indexer state and statistics.

**Response:**

```json
{
  "success": true,
  "data": {
    "lastIndexedLedger": 12345,
    "lastIndexedCursor": "0000123450000000001-0000000001",
    "lastUpdated": "2024-01-15T10:30:00Z",
    "totalEvents": 150,
    "eventsByType": {
      "LoanRequested": 50,
      "LoanApproved": 45,
      "LoanRepaid": 55
    }
  }
}
```

### Get Borrower Events

```http
GET /api/indexer/events/borrower/:borrower?limit=50&offset=0
```

Returns all events for a specific borrower.

### Get Loan Events

```http
GET /api/indexer/events/loan/:loanId
```

Returns all events for a specific loan (request, approval, repayments).

### Get Recent Events

```http
GET /api/indexer/events/recent?limit=20&eventType=LoanRequested
```

Returns recent events, optionally filtered by type.

## Event Types

### LoanRequested

Emitted when a borrower requests a loan.

**Topics:**

- `[0]`: Event name ("LoanRequested")
- `[1]`: Borrower address
- `[2]`: Loan ID

**Value:** Loan amount (i128)

### LoanApproved

Emitted when a loan is approved.

**Topics:**

- `[0]`: Event name ("LoanApproved")
- `[1]`: Loan ID

**Value:** Empty

### LoanRepaid

Emitted when a borrower makes a repayment.

**Topics:**

- `[0]`: Event name ("LoanRepaid")
- `[1]`: Borrower address

**Value:** Repayment amount (i128)

## How It Works

### 1. Initialization

When the server starts, the indexer:

1. Loads configuration from environment variables
2. Connects to the database
3. Retrieves the last indexed ledger
4. Starts the polling loop

### 2. Polling Loop

Every `INDEXER_POLL_INTERVAL_MS`:

1. Query Stellar RPC for new events since last indexed ledger
2. Filter for LoanManager contract events
3. Decode XDR-encoded event data
4. Check for duplicates
5. Store new events in database
6. Update indexer state

### 3. Event Processing

For each event:

1. Decode event type from topics
2. Extract borrower address
3. Decode event-specific data (loan ID, amount)
4. Store in structured format

### 4. Error Handling

- **Temporary RPC failures**: Retry on next poll
- **Database errors**: Rollback transaction, retry
- **Invalid events**: Log and skip
- **Duplicate events**: Skip silently

## Best Practices

### RPC Rate Limiting

Stellar RPC has rate limits. To avoid hitting them:

1. Use reasonable poll intervals (30+ seconds)
2. Don't set batch size too high
3. Monitor RPC response times
4. Consider using a dedicated RPC node for production

### Data Retention

Stellar RPC only retains events for 7 days. The indexer ensures:

- Events are captured before they expire
- Historical data is preserved indefinitely
- No gaps in event history

### Monitoring

Monitor these metrics:

- Last indexed ledger (should increase regularly)
- Event processing lag (current ledger - last indexed)
- Failed indexing attempts
- Database query performance

### Scaling

For high-volume contracts:

1. Increase `INDEXER_BATCH_SIZE`
2. Decrease `INDEXER_POLL_INTERVAL_MS`
3. Add database indexes on frequently queried columns
4. Consider read replicas for API queries

## Troubleshooting

### Indexer Not Starting

**Symptom:** No events being indexed

**Solutions:**

- Check `LOAN_MANAGER_CONTRACT_ID` is set
- Verify `STELLAR_RPC_URL` is accessible
- Check database connection
- Review logs for errors

### Missing Events

**Symptom:** Events exist on-chain but not in database

**Solutions:**

- Check if indexer is running
- Verify contract ID matches deployed contract
- Check for errors in logs
- Manually reset `last_indexed_ledger` if needed

### Duplicate Events

**Symptom:** Same event appears multiple times

**Solutions:**

- Check `event_id` unique constraint exists
- Verify deduplication logic is working
- Review database transaction handling

### High RPC Costs

**Symptom:** Excessive RPC requests

**Solutions:**

- Increase `INDEXER_POLL_INTERVAL_MS`
- Decrease `INDEXER_BATCH_SIZE`
- Use a self-hosted RPC node
- Implement exponential backoff

## Testing

### Manual Testing

1. Deploy a test contract
2. Set `LOAN_MANAGER_CONTRACT_ID` to test contract
3. Trigger events (request loan, approve, repay)
4. Check `/api/indexer/status` for new events
5. Query events via API endpoints

### Integration Testing

```typescript
import { EventIndexer } from './eventIndexer';

describe('EventIndexer', () => {
  it('should index loan events', async () => {
    const indexer = new EventIndexer({
      rpcUrl: 'https://soroban-testnet.stellar.org',
      contractId: 'CTEST...',
      pollIntervalMs: 5000,
      batchSize: 10,
    });

    await indexer.start();
    // Wait for events to be indexed
    await new Promise((resolve) => setTimeout(resolve, 10000));
    indexer.stop();

    // Verify events in database
  });
});
```

## Future Enhancements

- [ ] WebSocket support for real-time event streaming
- [ ] Event replay functionality
- [ ] Multi-contract indexing
- [ ] Event filtering by date range
- [ ] Prometheus metrics export
- [ ] Automatic RPC failover
- [ ] Event archival to cold storage
- [ ] GraphQL API for complex queries

## References

- [Stellar RPC getEvents Documentation](https://developers.stellar.org/docs/data/rpc/api-reference/methods/getEvents)
- [Soroban Events Guide](https://developers.stellar.org/docs/smart-contracts/guides/events/ingest)
- [Stellar SDK Documentation](https://stellar.github.io/js-stellar-sdk/)

---

## Background Jobs

The backend runs several scheduled background jobs to maintain system integrity and sync with on-chain state. All jobs start automatically when the API process launches.

### Active Jobs

| Job                         | Schedule         | Env Var                                                           | Default           | Description                                                                         | Source                                   |
| --------------------------- | ---------------- | ----------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------- | ---------------------------------------- |
| **Event Indexer**           | Continuous poll  | `INDEXER_POLL_INTERVAL_MS`                                        | 30000ms (30s)     | Syncs on-chain events to PostgreSQL for fast queries                                | `services/eventIndexer.ts`               |
| **Default Checker**         | Interval         | `DEFAULT_CHECK_INTERVAL_MS`                                       | 1800000ms (30m)   | Calls on-chain `check_defaults` batch for overdue loans                             | `services/defaultChecker.ts`             |
| **Webhook Retry Scheduler** | Fixed 60s        | —                                                                 | 60s               | Retries failed webhook deliveries using exponential backoff                         | `services/webhookRetryScheduler.ts`      |
| **Score Reconciliation**    | Interval         | `SCORE_RECONCILIATION_INTERVAL_MS`                                | 3600000ms (1h)    | Compares database scores vs on-chain scores and optionally auto-corrects divergence | `services/scoreReconciliationService.ts` |
| **Notification Cleanup**    | Fixed 24h        | `NOTIFICATION_RETENTION_DAYS`, `READ_NOTIFICATION_RETENTION_DAYS` | 24h               | Deletes old read/unread notifications per retention policy                          | `services/notificationService.ts`        |
| **Loan Due Check**          | Cron `0 * * * *` | —                                                                 | Top of every hour | Notifies borrowers about upcoming loan repayments                                   | `cron/loanCheckCron.ts`                  |

### Jobs Defined But Not Wired

These services exist in the codebase but are **not currently started** in `index.ts`:

- **`scoreDecayJob`** (`cron/scoreDecayJob.ts`) — Periodic credit score decay logic (not scheduled)
- **`webhookRetryProcessor`** (`services/webhookRetryProcessor.ts`) — Alternative webhook retry implementation (superseded by `webhookRetryScheduler`)

### Related Documentation

- [Indexer Recovery Runbook](../../docs/runbooks/indexer-recovery.md) — Troubleshooting indexer lag and manual re-sync
- [Webhooks Guide](../../docs/webhooks.md) — Webhook retry behavior and signature verification

### Monitoring

Key metrics to track for job health:

- **Indexer lag**: `current_ledger - last_indexed_ledger` (surfaced in `/health/deep`)
- **Default check success rate**: Logged in `jobMetricsService`
- **Webhook retry queue depth**: Query `webhook_deliveries` where `delivered_at IS NULL`
- **Score divergence count**: Logged after each reconciliation run
