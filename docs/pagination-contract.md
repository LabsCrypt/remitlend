# Keyset Pagination Contract

## Overview

RemitLend list endpoints use keyset (seek-based) pagination to provide stable pagination under concurrent writes. This document specifies the API contract that both backend and frontend must maintain.

## Problem

OFFSET/LIMIT pagination is vulnerable to window instability:

- Inserts before the current window shift all subsequent rows down
- Deletes before the current window shift all subsequent rows up
- The COUNT(\*) total may drift from the page query snapshot

This causes duplicate and skipped rows across page fetches during concurrent writes.

## Solution: Keyset Pagination with Snapshot Pinning

### Monotonic Ordering

Each paginated table (loans, remittances, ledger_events) has a `seq` column:

- BIGINT GENERATED ALWAYS AS IDENTITY
- Assigned in insertion order (monotonically increasing)
- Backfilled in (created_at, id) order to preserve logical ordering

### Snapshot Pinning

The first request pins `snapshot_seq = MAX(seq)` at query time. Subsequent requests carry this snapshot pinned, so:

- The page window is stable: only rows with `seq <= snapshot_seq` are visible
- The total count is stable: COUNT(\*) WHERE seq <= snapshot_seq never changes
- Rows inserted after the scroll began are excluded from both the window and the total

### Seek Predicate

List queries use a composite seek predicate instead of OFFSET:

```sql
WHERE seq <= $snapshot_seq
  AND (created_at, seq) < ($cursor_created_at, $cursor_seq)
ORDER BY created_at DESC, seq DESC
LIMIT $limit + 1
```

Fetching `limit + 1` rows detects end-of-list without a second round trip.

### Composite Index

Each paginated table has a composite seek index:

```sql
CREATE INDEX idx_<table>_seek ON <table>(created_at DESC, seq DESC)
```

This index accelerates the (created_at, seq) tuple predicate.

## API Response Contract

Every list endpoint returns:

```json
{
  "items": [
    {
      "id": "...",
      ...
    }
  ],
  "page": {
    "next_cursor": "<base64url|null>",
    "snapshot_seq": 148223,
    "total_at_snapshot": 4021,
    "limit": 50
  }
}
```

### Fields

- `items`: Array of result objects (max `limit` items)
- `page.next_cursor`: Opaque base64url-encoded cursor for the next page, or `null` if end-of-list
- `page.snapshot_seq`: The seq value pinned at first request; passed by client on all subsequent requests
- `page.total_at_snapshot`: COUNT(\*) WHERE seq <= snapshot_seq at query time
- `page.limit`: The limit used for this page

### Cursor Format

Cursors are opaque and must not be parsed by the client. They encode:

- `created_at` (ISO 8601 timestamp)
- `seq` (BIGINT)

Encoded as base64url string. A malformed cursor returns HTTP 400 with code `INVALID_CURSOR`.

## Client Invariants

1. **Never parse cursors**: Treat `next_cursor` as an opaque string
2. **Pin snapshot_seq**: Carry `snapshot_seq` from the first response on all subsequent page requests
3. **Detect end-of-list**: When `next_cursor` is `null`, the client has fetched all rows in the snapshot
4. **No live-row splicing**: SSE-streamed rows must not be merged into the paginated result mid-scroll, as this would destabilize the cursor

## Server Invariants

1. **No OFFSET in queries**: All list queries use the seek predicate, never OFFSET
2. **Clamp limit**: `limit` is clamped to [1, PAGINATION_MAX_LIMIT] (default max: 100)
3. **Strict cursor validation**: Invalid cursors return HTTP 400 with code `INVALID_CURSOR`
4. **Stable total**: `total_at_snapshot` does not change across the full cursor chain
5. **Index scans only**: EXPLAIN ANALYZE must show index scans on the composite seek index, never sequential table scans

## Migration Path

All paginated tables must have:

1. A `seq` BIGINT GENERATED ALWAYS AS IDENTITY column
2. A composite index `CREATE INDEX idx_<table>_seek ON <table>(created_at DESC, seq DESC)`
3. All existing rows backfilled with non-null `seq` values in (created_at, id) order

## Verification

- Unit tests: encodeCursor/decodeCursor roundtrip, INVALID_CURSOR rejection, buildKeysetClause predicate shape
- Integration test: concurrent inserts/deletes between page fetches; zero skipped/duplicated rows; stable total
- E2E (Playwright): infinite scroll to end under concurrent writes; no duplicate keys
- EXPLAIN ANALYZE: index scan on seek index; no sequential table scans
