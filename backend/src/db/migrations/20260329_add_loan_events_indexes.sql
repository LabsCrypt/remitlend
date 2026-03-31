-- Migration: Add missing indexes on loan_events table

-- Index for borrower history queries
CREATE INDEX IF NOT EXISTS idx_loan_events_borrower
ON loan_events(borrower);

-- Index for filtering by event type
CREATE INDEX IF NOT EXISTS idx_loan_events_event_type
ON loan_events(event_type);

-- Composite index for loan detail queries
CREATE INDEX IF NOT EXISTS idx_loan_events_loan_id_event_type
ON loan_events(loan_id, event_type);

-- Index for date range filters
CREATE INDEX IF NOT EXISTS idx_loan_events_created_at
ON loan_events(created_at);
