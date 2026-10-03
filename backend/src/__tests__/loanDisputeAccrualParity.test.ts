import { jest, describe, it, expect, beforeEach, afterAll } from '@jest/globals';
import request from 'supertest';
import { Keypair } from '@stellar/stellar-sdk';
import { generateJwtToken } from '../services/authService.js';
import { accrueInterest } from '../money/loanAccrual.js';

/**
 * Regression test: GET /api/loans/borrower/:borrower and GET /api/loans/:loanId
 * must report identical accruedInterest/totalOwed/status for a loan that has an
 * open dispute.
 *
 * Both endpoints must freeze interest accrual at the ledger closest to (at or
 * before) the open dispute's creation instead of the current ledger:
 *   - getLoanDetails resolves the freeze ledger in TypeScript (loanController.ts)
 *   - getBorrowerLoans mirrors the lookup in its borrower-list SQL
 */

process.env.JWT_SECRET = 'test-jwt-secret-min-32-chars-long!!';
process.env.INTERNAL_API_KEY = 'test-internal-key';

type MockQueryResult = { rows: unknown[]; rowCount?: number };

// Real Stellar-format public key so path/param validation passes.
const BORROWER = Keypair.random().publicKey();
const LOAN_ID = 42;

const CURRENT_LEDGER = 300;
const APPROVED_LEDGER = 20;
const FREEZE_LEDGER = 60; // ledger of the event at/just before the dispute opened
const PRINCIPAL_STROOPS = 10_000_000_000n;
const RATE_BPS = 1200;
const TERM_LEDGERS = 17280;
const DISPUTE_CREATED_AT = '2025-01-04T12:00:00.000Z';

// The frozen accrual window is [approved, freeze], not [approved, current].
const FROZEN_ELAPSED = FREEZE_LEDGER - APPROVED_LEDGER;
const UNFROZEN_ELAPSED = CURRENT_LEDGER - APPROVED_LEDGER;

const frozenAccrued = Number(
  accrueInterest({
    remainingPrincipalStroops: PRINCIPAL_STROOPS,
    interestRateBps: RATE_BPS,
    elapsedLedgers: FROZEN_ELAPSED,
    termLedgers: TERM_LEDGERS,
  }),
);
const unfrozenAccrued = Number(
  accrueInterest({
    remainingPrincipalStroops: PRINCIPAL_STROOPS,
    interestRateBps: RATE_BPS,
    elapsedLedgers: UNFROZEN_ELAPSED,
    termLedgers: TERM_LEDGERS,
  }),
);

const mockQuery: jest.MockedFunction<
  (text: string, params?: unknown[]) => Promise<MockQueryResult>
> = jest.fn();

jest.unstable_mockModule('../db/connection.js', () => ({
  default: { query: mockQuery },
  query: mockQuery,
  getClient: jest.fn(),
  closePool: jest.fn(),
  withTransaction: jest.fn(),
}));

jest.unstable_mockModule('../services/cacheService.js', () => ({
  cacheService: {
    get: jest.fn<() => Promise<null>>().mockResolvedValue(null),
    set: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    delete: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    ping: jest.fn<() => Promise<string>>().mockResolvedValue('ok'),
    invalidatePattern: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  },
}));

jest.unstable_mockModule('../services/sorobanService.js', () => ({
  sorobanService: {
    ping: jest.fn<() => Promise<string>>().mockResolvedValue('ok'),
    healthCheck: jest
      .fn<() => Promise<{ connected: boolean; latestLedger: number }>>()
      .mockResolvedValue({ connected: true, latestLedger: 1000 }),
  },
}));

const { default: app } = await import('../app.js');

const bearer = (publicKey: string) => ({
  Authorization: `Bearer ${generateJwtToken(publicKey)}`,
});

const rows = (value: unknown[]): MockQueryResult => ({ rows: value, rowCount: value.length });

const loanEvents = [
  {
    event_type: 'LoanRequested',
    amount: String(PRINCIPAL_STROOPS),
    ledger: 10,
    ledger_closed_at: '2025-01-01T00:00:00.000Z',
    tx_hash: 'request-tx',
    interest_rate_bps: null,
    term_ledgers: null,
  },
  {
    event_type: 'LoanApproved',
    amount: null,
    ledger: APPROVED_LEDGER,
    ledger_closed_at: '2025-01-02T00:00:00.000Z',
    tx_hash: 'approve-tx',
    interest_rate_bps: RATE_BPS,
    term_ledgers: TERM_LEDGERS,
  },
  {
    event_type: 'LoanDefaulted',
    amount: null,
    ledger: FREEZE_LEDGER,
    ledger_closed_at: '2025-01-04T00:00:00.000Z',
    tx_hash: 'default-tx',
    interest_rate_bps: null,
    term_ledgers: null,
  },
];

// Row the borrower-list SQL is expected to produce once the freeze ledger has
// been substituted for the current ledger: same frozen accrual as the detail
// endpoint, not the (larger) unfrozen value.
const borrowerListRow = {
  loan_id: LOAN_ID,
  address: BORROWER,
  principal: String(PRINCIPAL_STROOPS),
  approved_at: '2025-01-02T00:00:00.000Z',
  approved_ledger: String(APPROVED_LEDGER),
  rate_bps: String(RATE_BPS),
  term_ledgers: String(TERM_LEDGERS),
  total_repaid: '0',
  is_defaulted: 1,
  effective_rate_bps: String(RATE_BPS),
  effective_term_ledgers: String(TERM_LEDGERS),
  effective_approved_ledger: String(APPROVED_LEDGER),
  dispute_freeze_ledger: FREEZE_LEDGER,
  accrued_interest: String(frozenAccrued),
  total_owed: String(Number(PRINCIPAL_STROOPS) + frozenAccrued),
  next_payment_deadline: '2025-06-01T00:00:00.000Z',
  status: 'defaulted',
  borrower: BORROWER,
  full_count: '1',
};

let borrowerListSql = '';

beforeEach(() => {
  borrowerListSql = '';
  mockQuery.mockReset();
  mockQuery.mockImplementation(async (sql: string) => {
    if (typeof sql !== 'string') {
      return rows([]);
    }
    if (sql.includes('indexer_state')) {
      return rows([{ last_indexed_ledger: CURRENT_LEDGER }]);
    }
    if (sql.includes('SELECT address FROM contract_events')) {
      return rows([{ address: BORROWER }]);
    }
    // Borrower list aggregate query.
    if (sql.includes('loan_summaries')) {
      borrowerListSql = sql;
      return rows([borrowerListRow]);
    }
    // getLoanDetails: earliest open dispute.
    if (sql.includes('FROM loan_disputes') && sql.includes("status = 'open'")) {
      return rows([{ created_at: DISPUTE_CREATED_AT }]);
    }
    // getLoanDetails: freeze-ledger lookup.
    if (sql.includes('ledger_closed_at <= $2')) {
      return rows([{ ledger: FREEZE_LEDGER, ledger_closed_at: '2025-01-04T00:00:00.000Z' }]);
    }
    // getLoanDetails: full event history.
    if (sql.includes('FROM contract_events') && sql.includes('ORDER BY ledger_closed_at ASC')) {
      return rows(loanEvents);
    }
    return rows([]);
  });
});

afterAll(() => {
  delete process.env.JWT_SECRET;
  delete process.env.INTERNAL_API_KEY;
});

describe('disputed-loan accrued interest parity across loan endpoints', () => {
  it('returns the same frozen accruedInterest/totalOwed through the detail and borrower-list endpoints', async () => {
    const detailRes = await request(app).get(`/api/loans/${LOAN_ID}`).set(bearer(BORROWER));
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.summary.disputeFrozen).toBe(true);
    expect(detailRes.body.summary.elapsedLedgers).toBe(FROZEN_ELAPSED);

    const listRes = await request(app).get(`/api/loans/borrower/${BORROWER}`).set(bearer(BORROWER));
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.loans).toHaveLength(1);

    const detail = detailRes.body.summary;
    const listLoan = listRes.body.data.loans[0];

    expect(listLoan.loanId).toBe(LOAN_ID);
    expect(listLoan.accruedInterest).toBe(detail.accruedInterest);
    expect(listLoan.totalOwed).toBe(detail.totalOwed);
    expect(listLoan.status).toBe(detail.status);
    expect(detail.accruedInterest).toBe(frozenAccrued);
  });

  it('stops accrual at the dispute-open ledger instead of the current ledger', async () => {
    const detailRes = await request(app).get(`/api/loans/${LOAN_ID}`).set(bearer(BORROWER));

    // Sanity: accruing to the current ledger would be strictly larger.
    expect(unfrozenAccrued).toBeGreaterThan(frozenAccrued);
    expect(detailRes.body.summary.accruedInterest).toBe(frozenAccrued);
    expect(detailRes.body.summary.accruedInterest).not.toBe(unfrozenAccrued);
    expect(detailRes.body.summary.elapsedLedgers).toBe(FROZEN_ELAPSED);
    expect(detailRes.body.summary.elapsedLedgers).not.toBe(UNFROZEN_ELAPSED);
  });

  it('resolves the freeze ledger inside the borrower-list SQL', async () => {
    await request(app).get(`/api/loans/borrower/${BORROWER}`).set(bearer(BORROWER));

    expect(borrowerListSql).toContain('dispute_freeze_ledger');
    expect(borrowerListSql).toContain("d.status = 'open'");
    expect(borrowerListSql).toContain('COALESCE(dispute_freeze_ledger, $2)');
  });
});
