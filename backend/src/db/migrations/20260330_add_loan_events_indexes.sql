-- Migration: add index on loan_events (event_type, created_at)
-- Speeds up the conditional-aggregation query in getPoolStats()

-- Up
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_loan_events_type_created_at
  ON loan_events (event_type, created_at);

-- Down
-- DROP INDEX CONCURRENTLY IF EXISTS idx_loan_events_type_created_at;