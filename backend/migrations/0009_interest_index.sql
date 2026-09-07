-- Migration 0009_interest_index.sql
-- Creates table interest_index for cumulative interest index tracking (issue #1382).
-- NUMERIC(78,0) holds the full i128 range exactly.

CREATE TABLE IF NOT EXISTS interest_index (
    loan_id BIGINT NOT NULL,
    ledger_seq BIGINT NOT NULL,
    index_value NUMERIC(78,0) NOT NULL,
    origin_index NUMERIC(78,0) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (loan_id, ledger_seq)
);

CREATE INDEX IF NOT EXISTS idx_interest_index_loan_ledger ON interest_index(loan_id, ledger_seq);
