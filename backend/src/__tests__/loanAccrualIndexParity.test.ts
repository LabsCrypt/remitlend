import { jest, describe, it, expect, beforeEach, afterAll } from '@jest/globals';
import request from 'supertest';
import { Keypair } from '@stellar/stellar-sdk';

/**
 * Accrual index replay (#1382).
 *
 * The loan manager settles an accrual window on every repayment and
 * publishes the interest of that window in an `accrue` event. The backend
 * stores those snapshots in `interest_index` and replays them, so the amount
 * the API reports is the amount the contract settled - not a one-shot
 * formula that drifts as soon as a loan is repaid in more than one
 * instalment.
 */

process.env.JWT_SECRET = 'test-jwt-secret-min-32-chars-long!!';
process.env.INTERNAL_API_KEY = 'test-internal-key';

type MockQueryResult = { rows: unknown[]; rowCount?: number };

const BORROWER = Keypair.random().publicKey();
const LOAN_ID = 123;

const PRINCIPAL_STROOPS = 10_000_000_000n; // 1_000 tokens
const RATE_BPS = 1200;
const TERM_LEDGERS = 17_280;
const APPROVED_LEDGER = 20;
const REPAY_LEDGER = 25;
const CURRENT_LEDGER = 30;

// The contract booked 347_222 stroops of interest for the window
// [20, 25) and carried 222_222 millionths of a stroop into the next window.
const BOOKED_INTEREST_STROOPS = 347_222n;
const BOOKED_RESIDUAL = 222_222n;

// The repayment of 5e9 is split between principal (4_999_982_639) and
// interest (173_605), so the outstanding interest is
// 347_222 - 173_605 + 173_617 (the open window [25, 30)) = 347_234 and the
// remaining principal is 5_000_017_361 + 173_605 = 5_000_173_605.
const EXPECTED_INTEREST_STROOPS = 347_234n;
const EXPECTED_REMAINING_PRINCIPAL_STROOPS = 5_000_173_605n;

const mockQuery: jest.MockedFunction<
  (text: string, params?: unknown[]) => Promise<MockQueryResult>
> = jest.fn();

await jest.unstable_mockModule('../db/connection.js', () => ({
  withAdvisoryLock: async (_key: string, fn: () => Promise<unknown>) => fn(),
  default: { query: mockQuery },
  query: mockQuery,
  getClient: jest.fn(),
  closePool: jest.fn(),
  withTransaction: jest.fn(),
}));

await jest.unstable_mockModule('../services/cacheService.js', () => ({
  cacheService: {
    get: jest.fn<() => Promise<null>>().mockResolvedValue(null),
    set: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    delete: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    ping: jest.fn<() => Promise<string>>().mockResolvedValue('ok'),
    invalidatePattern: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  },
}));

await jest.unstable_mockModule('../services/sorobanService.js', () => ({
  sorobanService: {
    ping: jest.fn<() => Promise<string>>().mockResolvedValue('ok'),
    healthCheck: jest
      .fn<() => Promise<{ connected: boolean; latestLedger: number }>>()
      .mockResolvedValue({ connected: true, latestLedger: CURRENT_LEDGER }),
  },
}));

const { default: app } = await import('../app.js');
const { generateJwtToken } = await import('../services/authService.js');

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
    event_type: 'LoanRepaid',
    amount: '5000000000',
    ledger: REPAY_LEDGER,
    ledger_closed_at: '2025-01-03T00:00:00.000Z',
    tx_hash: 'repay-tx',
    interest_rate_bps: null,
    term_ledgers: null,
  },
];

const accrueSnapshots = [
  {
    loan_id: LOAN_ID,
    ledger: REPAY_LEDGER,
    index_value: '1600000000000000000',
    index_delta: '600000000000000000',
    interest_delta: String(BOOKED_INTEREST_STROOPS),
    residual: String(BOOKED_RESIDUAL),
  },
];

// The second test books a different interest, so every test starts from the
// snapshot the contract published.
const resetSnapshots = () => {
  const snapshot = accrueSnapshots[0];
  if (!snapshot) throw new Error('the accrual snapshot is missing');
  snapshot.interest_delta = String(BOOKED_INTEREST_STROOPS);
  snapshot.residual = String(BOOKED_RESIDUAL);
};

let interestIndexSql = '';

beforeEach(() => {
  resetSnapshots();
  interestIndexSql = '';
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
    if (sql.includes('FROM loan_disputes')) {
      return rows([]);
    }
    if (sql.includes('FROM interest_index')) {
      interestIndexSql = sql;
      return rows(accrueSnapshots);
    }
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

describe('accrual index replay', () => {
  it('replays the accrual snapshots of the loan', async () => {
    const res = await request(app).get(`/api/loans/${LOAN_ID}`).set(bearer(BORROWER));

    expect(res.status).toBe(200);
    expect(interestIndexSql).toContain('FROM interest_index');
    expect(res.body.summary.accruedInterest).toBe(Number(EXPECTED_INTEREST_STROOPS));
    expect(res.body.summary.totalOwed).toBe(
      Number(EXPECTED_REMAINING_PRINCIPAL_STROOPS + EXPECTED_INTEREST_STROOPS),
    );
    expect(res.body.summary.status).toBe('active');
  });

  it('uses the interest the contract booked instead of recomputing the window', async () => {
    // A booked interest that no formula could reproduce proves the replay
    // takes the contract's own numbers.
    const snapshot = accrueSnapshots[0];
    if (!snapshot) throw new Error('the accrual snapshot is missing');
    snapshot.interest_delta = '400000';
    snapshot.residual = '0';

    const res = await request(app).get(`/api/loans/${LOAN_ID}`).set(bearer(BORROWER));

    expect(res.status).toBe(200);
    // 400_000 booked, of which 199_992 was paid with the repayment, plus
    // the open window (173_618 on the remaining principal).
    expect(res.body.summary.accruedInterest).toBe(373_626);
    expect(res.body.summary.totalOwed).toBe(5_000_199_992 + 373_626);
  });
});
