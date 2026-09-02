import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Request, Response } from 'express';

type MockQueryResult = { rows: Record<string, unknown>[] };

const mockQuery = jest.fn<(text: string, params?: unknown[]) => Promise<MockQueryResult>>();
const mockGetScoreConfig =
  jest.fn<() => { repaymentDelta: number; defaultPenalty: number; latePenalty: number }>();

jest.unstable_mockModule('../db/connection.js', () => ({
  query: mockQuery,
}));

jest.unstable_mockModule('../services/sorobanService.js', () => ({
  sorobanService: {
    getScoreConfig: mockGetScoreConfig,
  },
}));

const { simulatePayment, getRemittanceHistory } =
  await import('../controllers/simulationController.js');

function mockReqRes(overrides?: Partial<Request>) {
  const json = jest.fn();
  const req = {
    body: { amount: '100' },
    user: { publicKey: 'GABCDEF1234567890' },
    ...overrides,
  } as unknown as Request;
  const res = { json } as unknown as Response;
  return { req, res, json };
}

describe('simulatePayment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetScoreConfig.mockReturnValue({ repaymentDelta: 15, defaultPenalty: 50, latePenalty: 5 });
  });

  it('uses the configured repayment delta instead of a hardcoded value', async () => {
    mockGetScoreConfig.mockReturnValue({ repaymentDelta: 25, defaultPenalty: 50, latePenalty: 5 });
    mockQuery.mockResolvedValue({ rows: [{ score: 500 }] });

    const { req, res, json } = mockReqRes();
    await simulatePayment(req, res);

    expect(json).toHaveBeenCalledWith(expect.objectContaining({ newScore: 525 }));
  });

  it('returns 500 + 15 = 515 with the default delta', async () => {
    mockQuery.mockResolvedValue({ rows: [{ score: 500 }] });

    const { req, res, json } = mockReqRes();
    await simulatePayment(req, res);

    expect(json).toHaveBeenCalledWith(expect.objectContaining({ newScore: 515 }));
  });

  it('clamps the new score at 850', async () => {
    mockQuery.mockResolvedValue({ rows: [{ score: 840 }] });

    const { req, res, json } = mockReqRes();
    await simulatePayment(req, res);

    expect(json).toHaveBeenCalledWith(expect.objectContaining({ newScore: 850 }));
  });

  it('defaults to score 500 when no score record exists', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const { req, res, json } = mockReqRes();
    await simulatePayment(req, res);

    expect(json).toHaveBeenCalledWith(expect.objectContaining({ newScore: 515 }));
  });
});

describe('getRemittanceHistory', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function historyReqRes() {
    const json = jest.fn();
    const next = jest.fn();
    const req = { params: { userId: 'GABCDEF1234567890' } } as unknown as Request;
    const res = { json } as unknown as Response;
    return { req, res, json, next };
  }

  // `asyncHandler` (src/utils/asyncHandler.ts) wraps the controller as
  // `(req, res, next) => void` and forwards rejections to `next` rather than
  // returning/rejecting a promise the caller can await. Flush the microtask
  // queue after invoking it so the mocked `query` promises have settled and
  // `res.json`/`next` have actually been called before asserting.
  async function flush(): Promise<void> {
    await new Promise((resolve) => setImmediate(resolve));
  }

  it('sums same-month repayments exactly in stroops instead of accumulating float drift', async () => {
    // Three repayments of 33,333,333 stroops (0.3333333 XLM) in the same
    // month. Summing `parseFloat(amount) / 1e7` per event (the previous
    // implementation) compounds float rounding error across the reduce;
    // summing bigint stroops and formatting once at the end does not.
    const closedAt = '2024-03-15T00:00:00.000Z';
    mockQuery.mockResolvedValueOnce({ rows: [{ score: 500 }] }).mockResolvedValueOnce({
      rows: [
        { event_type: 'LoanRepaid', amount: '33333333', ledger_closed_at: closedAt },
        { event_type: 'LoanRepaid', amount: '33333333', ledger_closed_at: closedAt },
        { event_type: 'LoanRepaid', amount: '33333333', ledger_closed_at: closedAt },
      ],
    });

    const { req, res, json, next } = historyReqRes();
    getRemittanceHistory(req, res, next);
    await flush();

    expect(next).not.toHaveBeenCalled();

    const totalStroops = 33_333_333n * 3n; // 99,999,999 stroops
    const expectedAmount = Number(totalStroops) / 1e7; // exact for this magnitude

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        history: [expect.objectContaining({ amount: expectedAmount, status: 'Completed' })],
      }),
    );
  });

  it('marks a month Defaulted and does not count it toward the streak', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ score: 500 }] }).mockResolvedValueOnce({
      rows: [
        {
          event_type: 'LoanDefaulted',
          amount: null,
          ledger_closed_at: '2024-01-15T00:00:00.000Z',
        },
        {
          event_type: 'LoanRepaid',
          amount: '10000000',
          ledger_closed_at: '2024-02-15T00:00:00.000Z',
        },
      ],
    });

    const { req, res, json, next } = historyReqRes();
    getRemittanceHistory(req, res, next);
    await flush();

    expect(next).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ streak: 1 }));
  });

  it('rejects a stroop amount with a genuine fractional part instead of truncating it', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ score: 500 }] }).mockResolvedValueOnce({
      rows: [
        {
          event_type: 'LoanRepaid',
          amount: '10000000.5',
          ledger_closed_at: '2024-01-15T00:00:00.000Z',
        },
      ],
    });

    const { req, res } = historyReqRes();
    const next = jest.fn();
    getRemittanceHistory(req, res, next);
    // asyncHandler forwards rejections to `next` rather than rejecting the
    // handler's own return value, so flush the microtask queue instead of
    // awaiting the (void) call directly.
    await new Promise((resolve) => setImmediate(resolve));

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('must be an integer stroop count'),
      }),
    );
  });
});
