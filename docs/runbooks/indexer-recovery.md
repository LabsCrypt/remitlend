# Indexer Recovery Runbook

When the event indexer falls behind, crashes, or encounters an RPC outage, use this runbook to restore normal operation.

---

## 1. Detecting Indexer Lag

### Via Health Endpoint

```bash
curl -H "x-api-key: ${INTERNAL_API_KEY}" /api/indexer/status
```

Check the `last_indexed_ledger` field against the current Stellar ledger sequence (available from the RPC `getLatestLedger` method). A gap larger than `INDEXER_POLL_INTERVAL_MS × 2` indicates lag.

### Via Prometheus Metrics (future)

Once Prometheus is deployed, alert on:

- `indexer_lag_ledgers > 100`
- `indexer_last_indexed_timestamp > 5 minutes ago`

### Via Database Query

```sql
SELECT
  (SELECT MAX(ledger) FROM contract_events) AS last_indexed_ledger,
  (SELECT MAX(ledger_closed_at) FROM contract_events) AS last_indexed_timestamp;
```

Compare the timestamp to `NOW()`. A difference > 5 minutes suggests the indexer is stuck or has crashed.

---

## 2. Safe Pause / Resume

### Pause the Indexer

If the indexer is consuming too many resources or if you need to investigate:

```bash
curl -X POST /api/admin/indexer/pause \
  -H "x-api-key: ${INTERNAL_API_KEY}"
```

The indexer will finish its current poll cycle and then stop. In-flight events are not lost because the indexer tracks the last indexed ledger in the database.

### Verify Paused State

```bash
curl -H "x-api-key: ${INTERNAL_API_KEY}" /api/indexer/status
```

Look for `status: "paused"`.

### Resume the Indexer

```bash
curl -X POST /api/admin/indexer/resume \
  -H "x-api-key: ${INTERNAL_API_KEY}"
```

The indexer resumes from the last indexed ledger stored in `indexer_state`.

---

## 3. Using `reindex-ledger-range`

When events are missing or corrupted for a specific ledger range, you can re-index a range of ledgers.

### Syntax

```bash
curl -X POST /api/admin/indexer/reindex \
  -H "Content-Type: application/json" \
  -H "x-api-key: ${INTERNAL_API_KEY}" \
  -d '{
    "startLedger": 123456,
    "endLedger": 123500,
    "contractIds": ["CA...", "CB..."]
  }'
```

### When to Use

- A batch of events was mis-decoded due to a schema upgrade.
- The `contract_events` table has gaps in a known ledger range.
- An RPC node returned incomplete results and you need to retry.

### Behaviour

1. The indexer resets its `last_indexed_ledger` to `startLedger - 1` for the affected contracts.
2. Events in the range are re-fetched and upserted (`ON CONFLICT (event_id) DO NOTHING`).
3. The indexer resumes normal polling from `endLedger + 1`.

---

## 4. Inspecting and Reprocessing Quarantined Events

Events that fail decoding or validation are moved to a quarantine table.

### View Quarantined Events

```bash
curl /api/admin/indexer/quarantine \
  -H "x-api-key: ${INTERNAL_API_KEY}"
```

Response includes:

- `event_id` — original Soroban event ID
- `ledger` — ledger sequence
- `error` — the error message that caused quarantine
- `raw_payload` — raw XDR base64 for debugging

### Reprocess a Quarantined Event

Once the issue is resolved (e.g., a decoding bug is fixed):

```bash
curl -X POST /api/admin/indexer/quarantine/{event_id}/reprocess \
  -H "x-api-key: ${INTERNAL_API_KEY}"
```

The event is re-decoded and inserted into `contract_events`. If it fails again, it stays in quarantine.

### Bulk Reprocess All

```bash
curl -X POST /api/admin/indexer/quarantine/reprocess-all \
  -H "x-api-key: ${INTERNAL_API_KEY}"
```

Use this after a hotfix deployment to clear the quarantine backlog.

---

## 5. Handling an RPC Outage

### Symptoms

- `/api/indexer/status` returns `rpc_status: "unreachable"`.
- Backend logs show repeated `ERR_HTTP_REQUEST` or timeout errors from the Soroban RPC.

### Steps

1. **Verify RPC availability** from a separate host:
   ```bash
   curl -X POST <STELLAR_RPC_URL> \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'
   ```

2. **Failover to a secondary RPC** if available:
   - Update the `STELLAR_RPC_URL` environment variable.
   - Restart the indexer via pause/resume or container restart.

3. **If no secondary RPC is available:**
   - Pause the indexer (see Section 2).
   - Monitor the RPC provider status page.
   - Once RPC is restored, resume the indexer. The gap will be caught up automatically as the indexer polls from the last indexed ledger.

4. **If the outage exceeds 1 hour:**
   - Consider running the `reindex-ledger-range` command (Section 3) after the RPC is restored to ensure no events were missed during the outage window.

---

## 6. Escalation Contacts

For incidents that cannot be resolved with the steps above, escalate via the [contributor Telegram group](https://t.me/+DOylgFv1jyJlNzM0).

When escalating, include:

- Ledger range of the gap
- Indexer status JSON output
- Relevant backend log excerpts (redact any secrets)
- Steps already attempted
