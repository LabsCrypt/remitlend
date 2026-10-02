// ─── Env vars MUST be set before any app imports ─────────────────────────────

process.env.JWT_SECRET = 'test-secret';
process.env.INTERNAL_API_KEY = 'test-api-key';
process.env.NODE_ENV = 'test';

import { jest } from '@jest/globals';

// ESM-compatible mocking
const mockQuery = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.unstable_mockModule('../db/connection.js', () => ({
  query: mockQuery,
  default: { query: mockQuery, connect: jest.fn(), end: jest.fn() },
  withTransaction: jest.fn(),
}));
jest.unstable_mockModule('../db/transaction.js', () => ({
  withTransaction: jest.fn(),
  withStellarAndDbTransaction: jest.fn(),
}));

// The on-chain leg of a dispute reversal (#1803) is submitted through
// `defaultChecker.reverseDefault`; mocking it keeps the suite off the network
// and lets the tests drive both the success and the failure path.
const mockReverseDefault = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.unstable_mockModule('../services/defaultChecker.js', () => ({
  defaultChecker: { reverseDefault: mockReverseDefault },
  DefaultChecker: class {},
  startDefaultCheckerScheduler: jest.fn(),
  stopDefaultCheckerScheduler: jest.fn(),
}));

let request: typeof import('supertest');
let jwt: typeof import('jsonwebtoken');
let app: any;
// Dynamic imports after mocks
beforeAll(async () => {
  ({ default: request } = await import('supertest'));
  ({ default: jwt } = await import('jsonwebtoken'));
  ({ default: app } = await import('../app.js'));
});

// ─── Constants ────────────────────────────────────────────────────────────────
// Real Stellar-format public key so any key-format validation passes
const TEST_PUBLIC_KEY = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN';
const ADMIN_API_KEY = 'test-api-key';
const LOAN_ID = 42;
const DISPUTE_ID = 7;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function mintToken(publicKey = TEST_PUBLIC_KEY) {
  return jwt.sign(
    { publicKey, role: 'borrower', scopes: ['read:loans', 'write:loans'] },
    process.env.JWT_SECRET!,
    { algorithm: 'HS256', expiresIn: '1h' },
  );
}

/** Shorthand for a resolved pg QueryResult with rows */
function dbRows(rows: object[], command = 'SELECT') {
  return { rows, rowCount: rows.length, command, oid: 0, fields: [] };
}

/** Shorthand for a resolved pg QueryResult with no rows */
function dbOk(command = 'INSERT') {
  return { rows: [], rowCount: 1, command, oid: 0, fields: [] };
}

// ─── Test state ───────────────────────────────────────────────────────────────

let authToken: string;
const defaultedLoanId = LOAN_ID;
let disputeId = DISPUTE_ID;

// Setup test loan and defaulted state before tests
beforeAll(async () => {
  // Wait for dynamic imports
  if (!request || !jwt || !app) {
    ({ default: request } = await import('supertest'));
    ({ default: jwt } = await import('jsonwebtoken'));
    ({ default: app } = await import('../app.js'));
  }
  authToken = mintToken();

  mockQuery.mockReset();
  // [1] INSERT contract_events LoanRequested  RETURNING loan_id
  // [2] INSERT contract_events LoanApproved
  // [3] requireLoanBorrowerAccess: SELECT address FROM contract_events WHERE loan_id = 42
  // [4] markLoanDefaulted: SELECT loan_id FROM contract_events (existence check)
  // [5] markLoanDefaulted: INSERT contract_events LoanDefaulted
  mockQuery
    .mockResolvedValueOnce(dbRows([{ loan_id: LOAN_ID }]))
    .mockResolvedValueOnce(dbOk())
    .mockResolvedValueOnce(dbRows([{ address: TEST_PUBLIC_KEY }]))
    .mockResolvedValueOnce(dbRows([{ loan_id: LOAN_ID }]))
    .mockResolvedValueOnce(dbOk());

  const loanRes = await request(app)
    .post('/api/loans')
    .set('Authorization', `Bearer ${authToken}`)
    .send({ amount: 1000, term: 12 });

  if (loanRes.status !== 200) {
    console.error('createTestLoan failed:', loanRes.status, loanRes.body);
  }

  const defaultRes = await request(app)
    .post(`/api/loans/${defaultedLoanId}/mark-defaulted`)
    .set('Authorization', `Bearer ${authToken}`)
    .send({ borrower: TEST_PUBLIC_KEY });

  if (defaultRes.status !== 200) {
    console.error('markLoanDefaulted failed:', defaultRes.status, defaultRes.body);
  }
}, 15000);

afterAll(() => {
  jest.restoreAllMocks();
});

beforeEach(() => {
  mockReverseDefault.mockReset();
});

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('Loan Dispute/Appeal Mechanism', () => {
  it('should reject contest if loan is not defaulted', async () => {
    /**
     * POST /api/loans/9999/contest-default
     *   requireLoanBorrowerAccess for loanId=9999:
     *   [1] SELECT address FROM contract_events WHERE loan_id = 9999 → no rows → 404
     *
     * Middleware throws notFound before contestDefault even runs.
     */
    mockQuery.mockResolvedValueOnce(dbRows([])); // [1] loan not found

    const res = await request(app)
      .post('/api/loans/9999/contest-default')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ reason: 'Test reason' });

    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('should allow borrower to contest a defaulted loan', async () => {
    /**
     * POST /api/loans/42/contest-default
     *   requireLoanBorrowerAccess:
     *   [1] SELECT address FROM contract_events WHERE loan_id = 42  → TEST_PUBLIC_KEY ✓
     *
     *   contestDefault:
     *   [2] SELECT contract_events WHERE event_type='LoanDefaulted'  → found
     *   [3] INSERT loan_disputes RETURNING id                    → disputeId
     *   [4] INSERT contract_events LoanDisputed
     */
    mockQuery
      .mockResolvedValueOnce(dbRows([{ address: TEST_PUBLIC_KEY }])) // [1] loanAccess
      .mockResolvedValueOnce(dbRows([{ loan_id: LOAN_ID }])) // [2] defaulted check
      .mockResolvedValueOnce(dbRows([{ id: DISPUTE_ID }])) // [3] dispute INSERT
      .mockResolvedValueOnce(dbOk()); // [4] LoanDisputed event

    const res = await request(app)
      .post(`/api/loans/${defaultedLoanId}/contest-default`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ reason: 'Indexer lag caused incorrect default.' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    disputeId = res.body.disputeId ?? disputeId;
  });

  it('should freeze penalty accrual during dispute', async () => {
    /**
     * GET /api/loans/42
     *   requireLoanBorrowerAccess:
     *   [1] SELECT address FROM contract_events WHERE loan_id = 42  → TEST_PUBLIC_KEY ✓
     *
     *   getLoanDetails:
     *   [2] SELECT all contract_events for loanId
     *   [3] SELECT last_indexed_ledger (getLatestLedger)
     *   [4] SELECT loan_disputes WHERE status='open'             → open dispute found
     *   [5] SELECT contract_events for freeze ledger lookup
     */
    mockQuery
      .mockResolvedValueOnce(dbRows([{ address: TEST_PUBLIC_KEY }])) // [1] loanAccess
      .mockResolvedValueOnce(
        dbRows([
          // [2] all loan events
          {
            event_type: 'LoanRequested',
            amount: '1000',
            ledger: 100,
            ledger_closed_at: new Date().toISOString(),
            tx_hash: null,
            interest_rate_bps: null,
            term_ledgers: null,
          },
          {
            event_type: 'LoanApproved',
            amount: '1000',
            ledger: 101,
            ledger_closed_at: new Date().toISOString(),
            tx_hash: null,
            interest_rate_bps: 1200,
            term_ledgers: 17280,
          },
          {
            event_type: 'LoanDefaulted',
            amount: null,
            ledger: 200,
            ledger_closed_at: new Date().toISOString(),
            tx_hash: null,
            interest_rate_bps: null,
            term_ledgers: null,
          },
        ]),
      )
      .mockResolvedValueOnce(dbRows([{ last_indexed_ledger: 300 }])) // [3] latest ledger
      .mockResolvedValueOnce(dbRows([{ created_at: new Date().toISOString() }])) // [4] open dispute
      .mockResolvedValueOnce(dbRows([{ ledger: 200, ledger_closed_at: new Date().toISOString() }])); // [5] freeze ledger

    const res = await request(app)
      .get(`/api/loans/${defaultedLoanId}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.summary?.disputeFrozen).toBe(true);
  });

  it('should allow admin to resolve dispute as confirm', async () => {
    /**
     * POST /api/admin/loan-disputes/:disputeId/resolve  (no loanAccess middleware)
     *   resolveLoanDispute:
     *   [1] SELECT loan_disputes WHERE id = disputeId AND status='open'  → found
     *   [2] UPDATE loan_disputes SET status='resolved'
     *   [3] INSERT contract_events DefaultConfirmed  (action = 'confirm')
     */
    mockQuery
      .mockResolvedValueOnce(
        dbRows([
          {
            id: disputeId,
            loan_id: LOAN_ID,
            borrower: TEST_PUBLIC_KEY,
            status: 'open',
          },
        ]),
      ) // [1]
      .mockResolvedValueOnce(dbOk('UPDATE')) // [2]
      .mockResolvedValueOnce(dbOk()); // [3]

    const res = await request(app)
      .post(`/api/admin/loan-disputes/${disputeId}/resolve`)
      .set('x-api-key', ADMIN_API_KEY)
      .send({ action: 'confirm', resolution: 'Default was valid.' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('should allow admin to resolve dispute as reverse', async () => {
    /**
     * resolveLoanDispute:
     *   [0] defaultChecker.reverseDefault(loanId)  → on-chain tx (mocked)
     *   [1] SELECT loan_disputes WHERE id = disputeId AND status='open'  → found
     *   [2] UPDATE loan_disputes SET status='resolved'
     *   [3] INSERT contract_events DefaultReversed  (action = 'reverse')
     */
    mockReverseDefault.mockResolvedValueOnce({
      loanId: LOAN_ID,
      txHash: 'c0ffee1234',
      ledger: 4321,
      txStatus: 'SUCCESS',
    });

    mockQuery
      .mockResolvedValueOnce(
        dbRows([
          {
            id: disputeId,
            loan_id: LOAN_ID,
            borrower: TEST_PUBLIC_KEY,
            status: 'open',
          },
        ]),
      ) // [1]
      .mockResolvedValueOnce(dbOk('UPDATE')) // [2]
      .mockResolvedValueOnce(dbOk()); // [3]

    const res = await request(app)
      .post(`/api/admin/loan-disputes/${disputeId}/resolve`)
      .set('x-api-key', ADMIN_API_KEY)
      .send({ action: 'reverse', resolution: 'Default was incorrect.' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockReverseDefault).toHaveBeenCalledWith(LOAN_ID);

    // The recorded event must carry the real on-chain tx hash, not the
    // synthetic `admin-dispute:<id>` marker this used to write (#1803).
    const insertCall = mockQuery.mock.calls.find(
      (call) => typeof call[0] === 'string' && (call[0] as string).includes('DefaultReversed'),
    );
    expect(insertCall).toBeDefined();
    const insertParams = insertCall![1] as unknown[];
    expect(insertParams).toContain('c0ffee1234');
    expect(insertParams.some((p) => typeof p === 'string' && p.startsWith('admin-dispute:'))).toBe(
      false,
    );
  });

  it('should not resolve a dispute when the on-chain reversal fails', async () => {
    /**
     * resolveLoanDispute with action='reverse', on-chain call fails:
     *   [1] SELECT loan_disputes WHERE id = disputeId AND status='open'  → found
     *   → throws 503 before any UPDATE or contract_events INSERT, so the dispute
     *     stays open instead of being recorded as resolved.
     */
    mockReverseDefault.mockResolvedValueOnce({
      loanId: LOAN_ID,
      error: 'prepareTransaction failed: pool liquidity unavailable',
    });

    // Scope the call count to this test: earlier tests in the file share the
    // same `mockQuery` instance.
    mockQuery.mockClear();
    mockQuery.mockResolvedValueOnce(
      dbRows([
        {
          id: disputeId,
          loan_id: LOAN_ID,
          borrower: TEST_PUBLIC_KEY,
          status: 'open',
        },
      ]),
    );

    const res = await request(app)
      .post(`/api/admin/loan-disputes/${disputeId}/resolve`)
      .set('x-api-key', ADMIN_API_KEY)
      .send({ action: 'reverse', resolution: 'Default was incorrect.' });

    expect(res.status).toBe(503);
    // Only the dispute lookup ran — nothing was marked resolved or logged.
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const statements = mockQuery.mock.calls.map((call) => String(call[0]));
    expect(statements.some((sql) => sql.includes('UPDATE loan_disputes'))).toBe(false);
    expect(statements.some((sql) => sql.includes('DefaultReversed'))).toBe(false);
  });
});
