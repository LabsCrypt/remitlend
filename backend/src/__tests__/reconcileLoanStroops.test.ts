import { jest } from '@jest/globals';

const mockQuery = jest.fn();

jest.unstable_mockModule('../db/connection.js', () => ({
  query: mockQuery,
  getClient: jest.fn(),
  closePool: jest.fn(),
  withTransaction: jest.fn(),
}));

const { reconcileLoanStroops } = await import('../services/defaultChecker.js');
const { toStroops } = await import('../money/decimal.js');

describe('reconcileLoanStroops', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('sums approved principal and repayments in exact stroops with zero drift once settled', async () => {
    const principal = toStroops('1000');
    // Two partial repayments that together exactly cover the principal —
    // this is the "dust reconciliation" invariant: owed == paid to the
    // stroop once a loan is fully repaid.
    const first = toStroops('333.3333333');
    const second = principal - first;

    mockQuery.mockResolvedValueOnce({
      rows: [
        { event_type: 'LoanApproved', amount: principal.toString() },
        { event_type: 'LoanRepaid', amount: first.toString() },
        { event_type: 'LoanRepaid', amount: second.toString() },
      ],
    });

    const result = await reconcileLoanStroops(42);

    expect(result.owedStroops).toBe(principal);
    expect(result.paidStroops).toBe(principal);
    expect(result.driftStroops).toBe(0n);
    expect(result.owedDisplay).toBe(result.paidDisplay);
  });

  it('reports the exact outstanding drift for a partially repaid loan', async () => {
    const principal = toStroops('500');
    const paid = toStroops('120.5000001');

    mockQuery.mockResolvedValueOnce({
      rows: [
        { event_type: 'LoanApproved', amount: principal.toString() },
        { event_type: 'LoanRepaid', amount: paid.toString() },
      ],
    });

    const result = await reconcileLoanStroops(7);

    expect(result.driftStroops).toBe(principal - paid);
  });

  it('is a no-op (zero owed, zero paid) for an unknown loan id', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await reconcileLoanStroops(999);

    expect(result.owedStroops).toBe(0n);
    expect(result.paidStroops).toBe(0n);
    expect(result.driftStroops).toBe(0n);
  });
});
