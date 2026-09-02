import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

type QueryResult = { rows: Record<string, unknown>[]; rowCount: number };
const mockQuery = jest.fn<(sql: string, params?: unknown[]) => Promise<QueryResult>>();

const mockSetAbsoluteUserScoresBulk = jest
  .fn<(scores: Map<string, number>) => Promise<void>>()
  .mockResolvedValue(undefined);

const mockGetOnChainCreditScore = jest
  .fn<(address: string) => Promise<number>>()
  .mockResolvedValue(700);

const mockRecordSuccess = jest.fn();
const mockRecordFailure = jest.fn();

jest.unstable_mockModule('../../db/connection.js', () => ({ query: mockQuery }));
jest.unstable_mockModule('../scoresService.js', () => ({
  setAbsoluteUserScoresBulk: mockSetAbsoluteUserScoresBulk,
}));
jest.unstable_mockModule('../sorobanService.js', () => ({
  sorobanService: { getOnChainCreditScore: mockGetOnChainCreditScore },
}));
jest.unstable_mockModule('../jobMetricsService.js', () => ({
  jobMetricsService: { recordSuccess: mockRecordSuccess, recordFailure: mockRecordFailure },
}));

const { crossContractReconciler } = await import('../crossContractReconciler.js');

/** Route the query mock by the marker comment in each SQL statement. */
function routeQueries(opts: {
  backfilled?: number;
  unresolved?: Record<string, unknown>[];
  matchByBorrower?: Record<string, number>;
  matchByTxHash?: Record<string, number>;
}) {
  const { backfilled = 0, unresolved = [], matchByBorrower = {}, matchByTxHash = {} } = opts;
  mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (sql.includes('/* backfill */')) return { rows: [], rowCount: backfilled };
    if (sql.includes('/* fetch-unresolved */'))
      return { rows: unresolved, rowCount: unresolved.length };
    if (sql.includes('/* match-score */')) {
      if (sql.includes('tx_hash = $3')) {
        const txHash = String(params?.[2] ?? '');
        const ledger = matchByTxHash[txHash] ?? matchByBorrower[String(params?.[0] ?? '')];
        return ledger != null ? { rows: [{ ledger }], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      const borrower = String(params?.[0] ?? '');
      const ledger = matchByBorrower[borrower];
      return ledger != null ? { rows: [{ ledger }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (sql.includes('/* update */')) return { rows: [], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
}

function row(over: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    id: 1,
    intent_key: 'LoanRepaid:1:evt-1',
    loan_id: 1,
    borrower: 'GB...ABC',
    operation: 'repay',
    disbursement_ledger: 1000,
    disbursement_tx_hash: 'tx-repay-1',
    expected_score_delta: 5,
    attempts: 0,
    state: 'pending',
    ...over,
  };
}

describe('crossContractReconciler.run', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.CROSS_RECONCILE_AUTOCORRECT_ENABLED;
    delete process.env.CROSS_RECONCILE_STALE_ATTEMPTS;
    routeQueries({});
  });

  afterEach(() => {
    delete process.env.CROSS_RECONCILE_AUTOCORRECT_ENABLED;
    delete process.env.CROSS_RECONCILE_STALE_ATTEMPTS;
  });

  it('returns an all-zero summary when there is nothing to reconcile', async () => {
    const result = await crossContractReconciler.run();
    expect(result.processedRows).toBe(0);
    expect(result.reconciledCount).toBe(0);
    expect(result.backfilledRows).toBe(0);
    expect(mockRecordSuccess).toHaveBeenCalledWith('crossContractReconciler', expect.any(Number));
  });

  it('reports rows backfilled from custody events', async () => {
    routeQueries({ backfilled: 3 });
    const result = await crossContractReconciler.run();
    expect(result.backfilledRows).toBe(3);
  });

  it('reconciles a no-score-expected (approve) row immediately', async () => {
    routeQueries({
      unresolved: [row({ operation: 'approve', expected_score_delta: 0 })],
    });
    const result = await crossContractReconciler.run();
    expect(result.reconciledCount).toBe(1);
    // No score-match lookup should be issued for a zero-delta op.
    expect(mockQuery.mock.calls.some(([sql]) => sql.includes('/* match-score */'))).toBe(false);
  });

  it('reconciles a repay row when a matching on-chain score event exists with same tx_hash', async () => {
    routeQueries({
      unresolved: [
        row({
          borrower: 'GB...ABC',
          disbursement_ledger: 1000,
          disbursement_tx_hash: 'tx-match-1',
        }),
      ],
      matchByTxHash: { 'tx-match-1': 1000 },
    });
    const result = await crossContractReconciler.run();
    expect(result.reconciledCount).toBe(1);
    expect(result.halfAppliedCount).toBe(0);
  });

  it('does not match unrelated subsequent score events on different tx_hashes', async () => {
    routeQueries({
      unresolved: [
        row({
          borrower: 'GB...ABC',
          disbursement_ledger: 1000,
          disbursement_tx_hash: 'tx-dropped-repay',
        }),
      ],
      // matchByTxHash only has the later repayment's tx_hash
      matchByTxHash: { 'tx-later-repay': 1050 },
    });
    const result = await crossContractReconciler.run();
    // Dropped repay must NOT be reconciled
    expect(result.reconciledCount).toBe(0);
    expect(result.stillPendingCount).toBe(1);
  });

  it('flags half_applied when no score event matched after enough attempts', async () => {
    process.env.CROSS_RECONCILE_STALE_ATTEMPTS = '1';
    routeQueries({
      unresolved: [row({ attempts: 0 })], // attempts+1 (1) >= staleAttempts (1)
      matchByBorrower: {}, // no match
    });
    const result = await crossContractReconciler.run();
    expect(result.halfAppliedCount).toBe(1);
    expect(result.reconciledCount).toBe(0);
    expect(mockSetAbsoluteUserScoresBulk).not.toHaveBeenCalled();
  });

  it('keeps a row pending when the staleness threshold is not yet reached', async () => {
    process.env.CROSS_RECONCILE_STALE_ATTEMPTS = '3';
    routeQueries({
      unresolved: [row({ attempts: 0 })], // attempts+1 (1) < 3
      matchByBorrower: {},
    });
    const result = await crossContractReconciler.run();
    expect(result.stillPendingCount).toBe(1);
    expect(result.halfAppliedCount).toBe(0);
  });

  it('DB-corrects the score to the on-chain value when autocorrect is enabled', async () => {
    process.env.CROSS_RECONCILE_STALE_ATTEMPTS = '1';
    process.env.CROSS_RECONCILE_AUTOCORRECT_ENABLED = 'true';
    mockGetOnChainCreditScore.mockResolvedValueOnce(742);
    routeQueries({
      unresolved: [row({ borrower: 'GB...ZZZ', attempts: 0 })],
      matchByBorrower: {},
    });
    const result = await crossContractReconciler.run();
    expect(result.halfAppliedCount).toBe(1);
    expect(result.correctedCount).toBe(1);
    expect(mockSetAbsoluteUserScoresBulk).toHaveBeenCalledTimes(1);
    const arg = mockSetAbsoluteUserScoresBulk.mock.calls[0]?.[0] as Map<string, number>;
    expect(arg.get('GB...ZZZ')).toBe(742);
  });
});
