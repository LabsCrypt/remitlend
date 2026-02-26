# Event Indexer Service

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
# Stellar RPC endpoint (testnet or mainnet)
STELLAR_RPC_URL=https://soroban-testnet.stellar.org

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
import { EventIndexer } from "./eventIndexer";

describe("EventIndexer", () => {
  it("should index loan events", async () => {
    const indexer = new EventIndexer({
      rpcUrl: "https://soroban-testnet.stellar.org",
      contractId: "CTEST...",
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
