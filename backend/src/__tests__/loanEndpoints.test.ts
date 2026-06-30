import request from 'supertest';
import { jest } from '@jest/globals';
import { Keypair } from '@stellar/stellar-sdk';
import jwt from 'jsonwebtoken';
import { generateJwtToken } from '../services/authService.js';

type MockQueryResult = { rows: unknown[]; rowCount?: number };

const VALID_API_KEY = 'test-internal-key';
const TEST_BORROWER = Keypair.random().publicKey();

process.env.JWT_SECRET = 'test-jwt-secret-min-32-chars-long!!';
process.env.INTERNAL_API_KEY = VALID_API_KEY;

const mockQuery: jest.MockedFunction<
  (text: string, params?: unknown[]) => Promise<MockQueryResult>
> = jest.fn();

// Create mock client for transaction support
const mockRelease = jest.fn();
const mockClient = {
  query: mockQuery,
  release: mockRelease,
};

jest.unstable_mockModule('../db/connection.js', () => ({
  default: { query: mockQuery },
  query: mockQuery,
  getClient: jest.fn<() => Promise<typeof mockClient>>().mockResolvedValue(mockClient),
  closePool: jest.fn(),
  withTransaction: jest.fn(),
}));

// Mock CacheService to prevent Redis connections
jest.unstable_mockModule('../services/cacheService.js', () => ({
  cacheService: {
    get: jest.fn<() => Promise<null>>().mockResolvedValue(null),
    set: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    delete: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    ping: jest.fn<() => Promise<string>>().mockResolvedValue('ok'),
  },
}));

// Mock sorobanService to avoid real Stellar RPC calls
const mockBuildRequestLoanTx =
  jest.fn<
    (
      borrowerPublicKey: string,
      amount: number,
    ) => Promise<{ unsignedTxXdr: string; networkPassphrase: string }>
  >();
const mockBuildRepayTx =
  jest.fn<
    (
      borrowerPublicKey: string,
      loanId: number,
      amount: number,
    ) => Promise<{ unsignedTxXdr: string; networkPassphrase: string }>
  >();
const mockBuildDepositCollateralTx =
  jest.fn<
    (
      borrowerPublicKey: string,
      loanId: number,
      amount: number,
    ) => Promise<{ unsignedTxXdr: string; networkPassphrase: string }>
  >();
const mockBuildReleaseCollateralTx =
  jest.fn<
    (
      borrowerPublicKey: string,
      loanId: number,
    ) => Promise<{ unsignedTxXdr: string; networkPassphrase: string }>
  >();
const mockBuildRefinanceLoanTx =
  jest.fn<
    (
      borrowerPublicKey: string,
      loanId: number,
      newAmount: number,
      newTerm: number,
    ) => Promise<{ unsignedTxXdr: string; networkPassphrase: string }>
  >();
const mockBuildExtendLoanTx =
  jest.fn<
    (
      borrowerPublicKey: string,
      loanId: number,
      extraLedgers: number,
    ) => Promise<{ unsignedTxXdr: string; networkPassphrase: string }>
  >();
const mockBuildLiquidateTx =
  jest.fn<
    (
      liquidatorPublicKey: string,
      loanId: number,
    ) => Promise<{ unsignedTxXdr: string; networkPassphrase: string }>
  >();
const mockSubmitSignedTx =
  jest.fn<
    (signedTxXdr: string) => Promise<{ txHash: string; status: string; resultXdr?: string }>
  >();
jest.unstable_mockModule('../services/sorobanService.js', () => ({
  sorobanService: {
    buildRequestLoanTx: mockBuildRequestLoanTx,
    buildRepayTx: mockBuildRepayTx,
    buildDepositCollateralTx: mockBuildDepositCollateralTx,
    buildReleaseCollateralTx: mockBuildReleaseCollateralTx,
    buildRefinanceLoanTx: mockBuildRefinanceLoanTx,
    buildExtendLoanTx: mockBuildExtendLoanTx,
    buildLiquidateTx: mockBuildLiquidateTx,
    submitSignedTx: mockSubmitSignedTx,
  },
}));

await import('../db/connection.js');
await import('../services/sorobanService.js');
const { default: app } = await import('../app.js');

const mockedQuery = mockQuery;

const bearer = (publicKey: string) => ({
  Authorization: `Bearer ${generateJwtToken(publicKey)}`,
});

// Mints a token with explicit scopes, bypassing rbac.ts role resolution,
// so we can simulate a caller missing a required write scope.
const bearerWithScopes = (publicKey: string, scopes: string[]) => ({
  Authorization: `Bearer ${jwt.sign(
    { publicKey, role: 'borrower', scopes },
    process.env.JWT_SECRET!,
    { algorithm: 'HS256', expiresIn: '1h' },
  )}`,
});

beforeEach(() => {
  mockedQuery.mockReset();
  jest.clearAllMocks();
});

afterAll(() => {
  delete process.env.INTERNAL_API_KEY;
  delete process.env.JWT_SECRET;
});

// ---------------------------------------------------------------------------
// GET /api/loans/config
// ---------------------------------------------------------------------------
describe('GET /api/loans/config', () => {
  const originalMinScore = process.env.LOAN_MIN_SCORE;
  const originalMaxAmount = process.env.LOAN_MAX_AMOUNT;
  const originalInterest = process.env.LOAN_INTEREST_RATE_PERCENT;

  afterEach(() => {
    if (originalMinScore === undefined) {
      delete process.env.LOAN_MIN_SCORE;
    } else {
      process.env.LOAN_MIN_SCORE = originalMinScore;
    }

    if (originalMaxAmount === undefined) {
      delete process.env.LOAN_MAX_AMOUNT;
    } else {
      process.env.LOAN_MAX_AMOUNT = originalMaxAmount;
    }

    if (originalInterest === undefined) {
      delete process.env.LOAN_INTEREST_RATE_PERCENT;
    } else {
      process.env.LOAN_INTEREST_RATE_PERCENT = originalInterest;
    }
  });

  it('should return configured env values when all required vars are set', async () => {
    process.env.LOAN_MIN_SCORE = '500';
    process.env.LOAN_MAX_AMOUNT = '50000';
    process.env.LOAN_INTEREST_RATE_PERCENT = '12';
    process.env.CREDIT_SCORE_THRESHOLD = '600';

    const response = await request(app).get('/api/loans/config');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        minScore: 500,
        maxAmount: 50000,
        interestRatePercent: 12,
        creditScoreThreshold: 600,
      },
    });
  });

  it('should return configured env values', async () => {
    process.env.LOAN_MIN_SCORE = '620';
    process.env.LOAN_MAX_AMOUNT = '65000';
    process.env.LOAN_INTEREST_RATE_PERCENT = '14';
    process.env.CREDIT_SCORE_THRESHOLD = '640';

    const response = await request(app).get('/api/loans/config');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        minScore: 620,
        maxAmount: 65000,
        interestRatePercent: 14,
        creditScoreThreshold: 640,
      },
    });
  });
});

// ---------------------------------------------------------------------------
// POST /api/loans/request
// ---------------------------------------------------------------------------
describe('POST /api/loans/request', () => {
  it('should reject unauthenticated requests', async () => {
    const response = await request(app)
      .post('/api/loans/request')
      .send({ amount: 1000, borrowerPublicKey: TEST_BORROWER });
    expect(response.status).toBe(401);
  });

  it('should reject when borrowerPublicKey does not match JWT', async () => {
    const otherBorrower = Keypair.random().publicKey();
    const response = await request(app)
      .post('/api/loans/request')
      .set(bearer(TEST_BORROWER))
      .send({ amount: 1000, borrowerPublicKey: otherBorrower });
    expect(response.status).toBe(403);
  });

  it('should return unsigned XDR for valid request', async () => {
    mockBuildRequestLoanTx.mockResolvedValueOnce({
      unsignedTxXdr: 'AAAA...base64xdr',
      networkPassphrase: 'Test SDF Network ; September 2015',
    });

    const response = await request(app)
      .post('/api/loans/request')
      .set(bearer(TEST_BORROWER))
      .send({ amount: 1000, borrowerPublicKey: TEST_BORROWER });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.unsignedTxXdr).toBe('AAAA...base64xdr');
    expect(response.body.networkPassphrase).toBeDefined();
  });

  it('should reject missing amount', async () => {
    const response = await request(app)
      .post('/api/loans/request')
      .set(bearer(TEST_BORROWER))
      .send({ borrowerPublicKey: TEST_BORROWER });
    expect(response.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /api/loans/submit
// ---------------------------------------------------------------------------
describe('POST /api/loans/submit', () => {
  it('should reject unauthenticated requests', async () => {
    const response = await request(app)
      .post('/api/loans/submit')
      .send({ signedTxXdr: 'c2lnbmVkLXhkcg==' });
    expect(response.status).toBe(401);
  });

  it('should submit a signed transaction', async () => {
    mockSubmitSignedTx.mockResolvedValueOnce({
      txHash: 'abc123hash',
      status: 'SUCCESS',
    });

    const response = await request(app)
      .post('/api/loans/submit')
      .set(bearer(TEST_BORROWER))
      .send({ signedTxXdr: 'c2lnbmVkLXhkci1kYXRh' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.txHash).toBe('abc123hash');
    expect(response.body.status).toBe('SUCCESS');
  });

  it('should reject missing signedTxXdr', async () => {
    const response = await request(app)
      .post('/api/loans/submit')
      .set(bearer(TEST_BORROWER))
      .send({});
    expect(response.status).toBe(400);
  });
});

describe('GET /api/loans/:loanId', () => {
  it('should return loan details for the authenticated borrower', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ address: TEST_BORROWER }] }) // address check
      .mockResolvedValueOnce({
        rows: [
          {
            event_type: 'LoanRequested',
            amount: '1000',
            ledger: 10,
            ledger_closed_at: '2025-01-01T00:00:00.000Z',
            tx_hash: 'request-tx',
            interest_rate_bps: null,
            term_ledgers: null,
          },
          {
            event_type: 'LoanApproved',
            amount: null,
            ledger: 20,
            ledger_closed_at: '2025-01-02T00:00:00.000Z',
            tx_hash: 'approve-tx',
            interest_rate_bps: 1200,
            term_ledgers: 17280,
          },
        ],
      }) // loan events
      .mockResolvedValueOnce({ rows: [{ last_indexed_ledger: 25 }] }) // getLatestLedger
      .mockResolvedValueOnce({ rows: [] }); // loan_disputes (no open disputes)

    const response = await request(app).get('/api/loans/123').set(bearer(TEST_BORROWER));

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.loanId).toBe('123');
    expect(response.body.summary.principal).toBe(1000);
  });

  it('should return 403 when the loan belongs to another borrower', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ address: 'other-wallet' }],
    });

    const response = await request(app).get('/api/loans/123').set(bearer(TEST_BORROWER));

    expect(response.status).toBe(403);
  });

  it('should return 404 when the loan does not exist', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [],
    });

    const response = await request(app).get('/api/loans/123').set(bearer(TEST_BORROWER));

    expect(response.status).toBe(404);
  });
});

describe('GET /api/loans/:loanId/amortization-schedule', () => {
  it('should return amortization schedule for an approved loan', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ address: 'GABC123' }] }).mockResolvedValueOnce({
      rows: [
        {
          event_type: 'LoanRequested',
          amount: '1000',
          ledger_closed_at: '2025-01-01T00:00:00.000Z',
        },
        {
          event_type: 'LoanApproved',
          amount: null,
          ledger_closed_at: '2025-01-01T00:00:00.000Z',
          interest_rate_bps: 1200,
          term_ledgers: 518400,
        },
      ],
    });

    const response = await request(app)
      .get('/api/loans/123/amortization-schedule')
      .set(bearer('GABC123'));

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.amortization).toMatchObject({
      principal: 1000,
      interestRateBps: 1200,
      termLedgers: 518400,
    });
    expect(Array.isArray(response.body.amortization.schedule)).toBe(true);
    expect(response.body.amortization.schedule.length).toBeGreaterThan(0);
  });

  it('should return 404 when loan is not fully approved', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ address: 'GABC123' }] }).mockResolvedValueOnce({
      rows: [
        {
          event_type: 'LoanRequested',
          amount: '1000',
          ledger_closed_at: '2025-01-01T00:00:00.000Z',
        },
      ],
    });

    const response = await request(app)
      .get('/api/loans/123/amortization-schedule')
      .set(bearer('GABC123'));

    expect(response.status).toBe(404);
  });
});

describe('POST /api/loans/amortization-preview', () => {
  const originalMinScore = process.env.LOAN_MIN_SCORE;
  const originalMaxAmount = process.env.LOAN_MAX_AMOUNT;
  const originalInterest = process.env.LOAN_INTEREST_RATE_PERCENT;
  const originalThreshold = process.env.CREDIT_SCORE_THRESHOLD;

  beforeEach(() => {
    process.env.LOAN_MIN_SCORE = '500';
    process.env.LOAN_MAX_AMOUNT = '50000';
    process.env.LOAN_INTEREST_RATE_PERCENT = '12';
    process.env.CREDIT_SCORE_THRESHOLD = '600';
  });

  afterEach(() => {
    if (originalMinScore === undefined) {
      delete process.env.LOAN_MIN_SCORE;
    } else {
      process.env.LOAN_MIN_SCORE = originalMinScore;
    }

    if (originalMaxAmount === undefined) {
      delete process.env.LOAN_MAX_AMOUNT;
    } else {
      process.env.LOAN_MAX_AMOUNT = originalMaxAmount;
    }

    if (originalInterest === undefined) {
      delete process.env.LOAN_INTEREST_RATE_PERCENT;
    } else {
      process.env.LOAN_INTEREST_RATE_PERCENT = originalInterest;
    }

    if (originalThreshold === undefined) {
      delete process.env.CREDIT_SCORE_THRESHOLD;
    } else {
      process.env.CREDIT_SCORE_THRESHOLD = originalThreshold;
    }
  });

  it('should return amortization preview for valid terms', async () => {
    const response = await request(app)
      .post('/api/loans/amortization-preview')
      .set(bearer('GABC123'))
      .send({ amount: 1000, termDays: 60 });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.amortization).toMatchObject({
      principal: 1000,
      interestRateBps: 1200,
      termLedgers: 1036800,
    });
    expect(Array.isArray(response.body.amortization.schedule)).toBe(true);
    expect(response.body.amortization.schedule.length).toBe(2);
  });

  it('should reject invalid termDays', async () => {
    const response = await request(app)
      .post('/api/loans/amortization-preview')
      .set(bearer('GABC123'))
      .send({ amount: 1000, termDays: 45 });

    expect(response.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /api/loans/:loanId/repay
// ---------------------------------------------------------------------------
describe('POST /api/loans/:loanId/repay', () => {
  it('should reject unauthenticated requests', async () => {
    const response = await request(app)
      .post('/api/loans/1/repay')
      .send({ amount: 500, borrowerPublicKey: TEST_BORROWER });
    expect(response.status).toBe(401);
  });

  it('should return unsigned XDR for valid repayment', async () => {
    // requireLoanBorrowerAccess check
    mockedQuery.mockResolvedValueOnce({
      rows: [{ address: TEST_BORROWER }],
    });

    mockBuildRepayTx.mockResolvedValueOnce({
      unsignedTxXdr: 'BBBB...repay-xdr',
      networkPassphrase: 'Test SDF Network ; September 2015',
    });

    const response = await request(app)
      .post('/api/loans/1/repay')
      .set(bearer(TEST_BORROWER))
      .send({ amount: 500, borrowerPublicKey: TEST_BORROWER });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.loanId).toBe(1);
    expect(response.body.unsignedTxXdr).toBe('BBBB...repay-xdr');
  });

  it('should return 403 when loan does not belong to user', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ address: 'other-wallet' }],
    });

    const response = await request(app)
      .post('/api/loans/1/repay')
      .set(bearer(TEST_BORROWER))
      .send({ amount: 500, borrowerPublicKey: TEST_BORROWER });

    expect(response.status).toBe(403);
  });

  it('should reject missing amount', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ address: TEST_BORROWER }],
    });

    const response = await request(app)
      .post('/api/loans/1/repay')
      .set(bearer(TEST_BORROWER))
      .send({ borrowerPublicKey: TEST_BORROWER });

    expect(response.status).toBe(400);
  });

  it('should reject a token missing the write:loans scope', async () => {
    const response = await request(app)
      .post('/api/loans/1/repay')
      .set(bearerWithScopes(TEST_BORROWER, ['read:loans']))
      .send({ amount: 500, borrowerPublicKey: TEST_BORROWER });

    expect(response.status).toBe(403);
    expect(mockBuildRepayTx).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// POST /api/loans/:loanId/submit
// ---------------------------------------------------------------------------
describe('POST /api/loans/:loanId/submit', () => {
  it('should submit a signed repayment transaction', async () => {
    // requireLoanBorrowerAccess
    mockedQuery.mockResolvedValueOnce({
      rows: [{ address: TEST_BORROWER }],
    });

    mockSubmitSignedTx.mockResolvedValueOnce({
      txHash: 'repay-hash-456',
      status: 'SUCCESS',
    });

    const response = await request(app)
      .post('/api/loans/1/submit')
      .set(bearer(TEST_BORROWER))
      .send({ signedTxXdr: 'c2lnbmVkLXJlcGF5LXhkcg==' });

    expect(response.status).toBe(200);
    expect(response.body.txHash).toBe('repay-hash-456');
    expect(response.body.status).toBe('SUCCESS');
  });
});

// ---------------------------------------------------------------------------
// POST /api/loans/:loanId/build-deposit-collateral
// ---------------------------------------------------------------------------
describe('POST /api/loans/:loanId/build-deposit-collateral', () => {
  it('should reject unauthenticated requests', async () => {
    const response = await request(app)
      .post('/api/loans/1/build-deposit-collateral')
      .send({ amount: 500, borrowerPublicKey: TEST_BORROWER });
    expect(response.status).toBe(401);
  });

  it('should return unsigned XDR for valid deposit collateral', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ address: TEST_BORROWER }],
    });

    mockBuildDepositCollateralTx.mockResolvedValueOnce({
      unsignedTxXdr: 'CCCC...deposit-collateral-xdr',
      networkPassphrase: 'Test SDF Network ; September 2015',
    });

    const response = await request(app)
      .post('/api/loans/1/build-deposit-collateral')
      .set(bearer(TEST_BORROWER))
      .send({ amount: 500, borrowerPublicKey: TEST_BORROWER });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.loanId).toBe(1);
    expect(response.body.unsignedTxXdr).toBe('CCCC...deposit-collateral-xdr');
  });

  it('should return 403 when loan does not belong to user', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ address: 'other-wallet' }],
    });

    const response = await request(app)
      .post('/api/loans/1/build-deposit-collateral')
      .set(bearer(TEST_BORROWER))
      .send({ amount: 500, borrowerPublicKey: TEST_BORROWER });

    expect(response.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// POST /api/loans/:loanId/build-release-collateral
// ---------------------------------------------------------------------------
describe('POST /api/loans/:loanId/build-release-collateral', () => {
  it('should reject unauthenticated requests', async () => {
    const response = await request(app)
      .post('/api/loans/1/build-release-collateral')
      .send({ borrowerPublicKey: TEST_BORROWER });
    expect(response.status).toBe(401);
  });

  it('should return unsigned XDR for valid release collateral', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ address: TEST_BORROWER }],
    });

    mockBuildReleaseCollateralTx.mockResolvedValueOnce({
      unsignedTxXdr: 'DDDD...release-collateral-xdr',
      networkPassphrase: 'Test SDF Network ; September 2015',
    });

    const response = await request(app)
      .post('/api/loans/1/build-release-collateral')
      .set(bearer(TEST_BORROWER))
      .send({ borrowerPublicKey: TEST_BORROWER });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.loanId).toBe(1);
    expect(response.body.unsignedTxXdr).toBe('DDDD...release-collateral-xdr');
  });

  it('should return 403 when loan does not belong to user', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ address: 'other-wallet' }],
    });

    const response = await request(app)
      .post('/api/loans/1/build-release-collateral')
      .set(bearer(TEST_BORROWER))
      .send({ borrowerPublicKey: TEST_BORROWER });

    expect(response.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// POST /api/loans/:loanId/build-refinance
// ---------------------------------------------------------------------------
describe('POST /api/loans/:loanId/build-refinance', () => {
  it('should reject unauthenticated requests', async () => {
    const response = await request(app).post('/api/loans/1/build-refinance').send({
      newAmount: 2000,
      newTerm: 34560,
      borrowerPublicKey: TEST_BORROWER,
    });
    expect(response.status).toBe(401);
  });

  it('should return unsigned XDR for valid refinance', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ address: TEST_BORROWER }],
    });

    mockBuildRefinanceLoanTx.mockResolvedValueOnce({
      unsignedTxXdr: 'EEEE...refinance-xdr',
      networkPassphrase: 'Test SDF Network ; September 2015',
    });

    const response = await request(app)
      .post('/api/loans/1/build-refinance')
      .set(bearer(TEST_BORROWER))
      .send({
        newAmount: 2000,
        newTerm: 34560,
        borrowerPublicKey: TEST_BORROWER,
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.loanId).toBe(1);
    expect(response.body.unsignedTxXdr).toBe('EEEE...refinance-xdr');
  });

  it('should return 403 when loan does not belong to user', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ address: 'other-wallet' }],
    });

    const response = await request(app)
      .post('/api/loans/1/build-refinance')
      .set(bearer(TEST_BORROWER))
      .send({
        newAmount: 2000,
        newTerm: 34560,
        borrowerPublicKey: TEST_BORROWER,
      });

    expect(response.status).toBe(403);
  });

  it('should reject missing newTerm', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ address: TEST_BORROWER }],
    });

    const response = await request(app)
      .post('/api/loans/1/build-refinance')
      .set(bearer(TEST_BORROWER))
      .send({ newAmount: 2000, borrowerPublicKey: TEST_BORROWER });

    expect(response.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /api/loans/:loanId/build-extend
// ---------------------------------------------------------------------------
describe('POST /api/loans/:loanId/build-extend', () => {
  it('should reject unauthenticated requests', async () => {
    const response = await request(app)
      .post('/api/loans/1/build-extend')
      .send({ extraLedgers: 8640, borrowerPublicKey: TEST_BORROWER });
    expect(response.status).toBe(401);
  });

  it('should return unsigned XDR for valid extend', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ address: TEST_BORROWER }],
    });

    mockBuildExtendLoanTx.mockResolvedValueOnce({
      unsignedTxXdr: 'FFFF...extend-xdr',
      networkPassphrase: 'Test SDF Network ; September 2015',
    });

    const response = await request(app)
      .post('/api/loans/1/build-extend')
      .set(bearer(TEST_BORROWER))
      .send({ extraLedgers: 8640, borrowerPublicKey: TEST_BORROWER });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.loanId).toBe(1);
    expect(response.body.unsignedTxXdr).toBe('FFFF...extend-xdr');
  });

  it('should return 403 when loan does not belong to user', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ address: 'other-wallet' }],
    });

    const response = await request(app)
      .post('/api/loans/1/build-extend')
      .set(bearer(TEST_BORROWER))
      .send({ extraLedgers: 8640, borrowerPublicKey: TEST_BORROWER });

    expect(response.status).toBe(403);
  });

  it('should reject missing extraLedgers', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ address: TEST_BORROWER }],
    });

    const response = await request(app)
      .post('/api/loans/1/build-extend')
      .set(bearer(TEST_BORROWER))
      .send({ borrowerPublicKey: TEST_BORROWER });

    expect(response.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /api/loans/:loanId/liquidate/build
// ---------------------------------------------------------------------------
describe('POST /api/loans/:loanId/liquidate/build', () => {
  it('should reject unauthenticated requests', async () => {
    const response = await request(app)
      .post('/api/loans/1/liquidate/build')
      .send({ liquidatorPublicKey: TEST_BORROWER });
    expect(response.status).toBe(401);
  });

  it('should return unsigned XDR for valid liquidation build request', async () => {
    mockBuildLiquidateTx.mockResolvedValueOnce({
      unsignedTxXdr: 'GGGG...liquidate-xdr',
      networkPassphrase: 'Test SDF Network ; September 2015',
    });

    const response = await request(app)
      .post('/api/loans/1/liquidate/build')
      .set(bearer(TEST_BORROWER))
      .send({ liquidatorPublicKey: TEST_BORROWER });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.loanId).toBe(1);
    expect(response.body.unsignedTxXdr).toBe('GGGG...liquidate-xdr');
    expect(mockBuildLiquidateTx).toHaveBeenCalledWith(TEST_BORROWER, 1);
  });

  it('should reject requests where liquidatorPublicKey does not match JWT', async () => {
    const otherWallet = Keypair.random().publicKey();
    const response = await request(app)
      .post('/api/loans/1/liquidate/build')
      .set(bearer(TEST_BORROWER))
      .send({ liquidatorPublicKey: otherWallet });

    expect(response.status).toBe(403);
  });

  it('should propagate non-liquidatable build failures', async () => {
    mockBuildLiquidateTx.mockRejectedValueOnce(new Error('Loan is not liquidatable'));

    const response = await request(app)
      .post('/api/loans/1/liquidate/build')
      .set(bearer(TEST_BORROWER))
      .send({ liquidatorPublicKey: TEST_BORROWER });

    expect(response.status).toBe(500);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toBe('Internal server error');
  });
});
