import request from 'supertest';
import { jest } from '@jest/globals';
import { Keypair } from '@stellar/stellar-sdk';

type MockQueryResult = { rows: unknown[]; rowCount?: number };

const BORROWER = Keypair.random().publicKey();
const ADMIN = Keypair.random().publicKey();

// Configure auth before any module that reads these at import/sign time.
process.env.JWT_SECRET = 'test-jwt-secret-min-32-chars-long!!';
process.env.ADMIN_WALLETS = ADMIN;

// Loan fixtures keyed by the id used in the request path. PENDING satisfies
// both the cancel (PENDING|OPEN) and reject (PENDING) guards.
const loans: Record<string, { status: string; address: string }> = {
  'loan-123': { status: 'PENDING', address: BORROWER },
  'open-loan': { status: 'OPEN', address: BORROWER },
  'defaulted-loan': { status: 'DEFAULTED', address: BORROWER },
  'completed-loan': { status: 'COMPLETED', address: BORROWER },
  'loan-1': { status: 'PENDING', address: BORROWER },
};

const mockQuery: jest.MockedFunction<
  (text: string, params?: unknown[]) => Promise<MockQueryResult>
> = jest.fn(async (text: string, params?: unknown[]) => {
  const loanId = params?.[0] as string | undefined;
  const loan = loanId ? loans[loanId] : undefined;

  // requireLoanOwner resolves the borrower from the unified loan_events view.
  if (/from\s+loan_events/i.test(text)) {
    return { rows: loan ? [{ address: loan.address }] : [] };
  }
  // Controllers load the loan row to check its status.
  if (/from\s+loans\s+where\s+id/i.test(text)) {
    return { rows: loan ? [{ id: loanId, status: loan.status }] : [] };
  }
  // audit_logs INSERT and anything else: no-op.
  return { rows: [] };
});

jest.unstable_mockModule('../../db/connection.js', () => ({
  default: { query: mockQuery },
  query: mockQuery,
  getClient: jest.fn(),
  closePool: jest.fn(),
  withTransaction: jest.fn(),
}));

// Keep Redis out of the test.
jest.unstable_mockModule('../cacheService.js', () => ({
  cacheService: {
    get: jest.fn<() => Promise<null>>().mockResolvedValue(null),
    set: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    delete: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    ping: jest.fn<() => Promise<string>>().mockResolvedValue('ok'),
  },
}));

// Avoid real Stellar RPC; return a deterministic unsigned transaction.
const mockBuildCancelLoanTx = jest
  .fn<(borrower: string, loanId: string) => Promise<unknown>>()
  .mockResolvedValue({
    unsignedTxXdr: 'AAAAcancel',
    networkPassphrase: 'Test',
  });
const mockBuildRejectLoanTx = jest
  .fn<(admin: string, loanId: string, reason: string) => Promise<unknown>>()
  .mockResolvedValue({
    unsignedTxXdr: 'AAAAreject',
    networkPassphrase: 'Test',
  });

jest.unstable_mockModule('../sorobanService.js', () => ({
  sorobanService: {
    buildCancelLoanTx: mockBuildCancelLoanTx,
    buildRejectLoanTx: mockBuildRejectLoanTx,
  },
}));

const { generateJwtToken } = await import('../authService.js');
const { default: app } = await import('../../app.js');

const borrowerAuth = `Bearer ${generateJwtToken(BORROWER)}`;
const adminAuth = `Bearer ${generateJwtToken(ADMIN)}`;

describe('POST /api/loans/:loanId/build-cancel', () => {
  it('should build cancel transaction', async () => {
    const response = await request(app)
      .post('/api/loans/loan-123/build-cancel')
      .set('Authorization', borrowerAuth);

    expect(response.status).toBe(200);
    expect(response.body.transaction).toBeDefined();
  });

  it('should reject non-cancellable loans', async () => {
    const response = await request(app)
      .post('/api/loans/completed-loan/build-cancel')
      .set('Authorization', borrowerAuth);

    expect(response.status).toBe(400);
  });

  it('should allow an OPEN loan to be cancelled', async () => {
    const response = await request(app)
      .post('/api/loans/open-loan/build-cancel')
      .set('Authorization', borrowerAuth);

    expect(response.status).toBe(200);
    expect(mockBuildCancelLoanTx).toHaveBeenCalledWith(BORROWER, 'open-loan');
  });

  it('should reject a DEFAULTED loan', async () => {
    const response = await request(app)
      .post('/api/loans/defaulted-loan/build-cancel')
      .set('Authorization', borrowerAuth);

    expect(response.status).toBe(400);
    expect(mockBuildCancelLoanTx).not.toHaveBeenCalledWith(BORROWER, 'defaulted-loan');
  });
});

describe('POST /api/admin/loans/:loanId/build-reject', () => {
  it('should build reject transaction', async () => {
    const response = await request(app)
      .post('/api/admin/loans/loan-123/build-reject')
      .set('Authorization', adminAuth)
      .send({ reason: 'Insufficient collateral' });

    expect(response.status).toBe(200);
    expect(response.body.transaction).toBeDefined();
  });

  it('should fail if reason too short', async () => {
    const response = await request(app)
      .post('/api/admin/loans/loan-1/build-reject')
      .set('Authorization', adminAuth)
      .send({ reason: 'bad' });

    expect(response.status).toBe(400);
  });
});
