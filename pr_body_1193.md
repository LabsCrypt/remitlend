Closes #1193

### What does this PR do?
This PR implements the missing `down()` function in the `1788000000018_add-loan-events-missing-indexes.js` migration file, which previously leaked four database indexes on rollback.

### Description
- **Clean Rollbacks:** Replaced the empty `down = () => {}` with explicit `DROP INDEX IF EXISTS` statements for all four indexes (`idx_loan_events_borrower`, `idx_loan_events_event_type`, `idx_loan_events_loan_id_event_type`, and `idx_loan_events_created_at`) created in the `up()` function.
- **Idempotency:** Ensures that rolling back and re-applying migrations works flawlessly without index collision errors.
