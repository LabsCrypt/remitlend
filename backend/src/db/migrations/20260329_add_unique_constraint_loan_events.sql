-- Migration: Add unique constraint to prevent duplicate loan events

ALTER TABLE loan_events
  ADD CONSTRAINT unique_loan_event
  UNIQUE (transaction_hash, event_index);
