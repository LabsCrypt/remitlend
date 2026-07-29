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

const { simulatePayment } = await import('../controllers/simulationController.js');

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
    mockQuery.mockResolvedValue({ rows: [{ current_score: 500 }] });

    const { req, res, json } = mockReqRes();
    await simulatePayment(req, res);

    expect(json).toHaveBeenCalledWith(expect.objectContaining({ newScore: 525 }));
  });

  it('returns 500 + 15 = 515 with the default delta', async () => {
    mockQuery.mockResolvedValue({ rows: [{ current_score: 500 }] });

    const { req, res, json } = mockReqRes();
    await simulatePayment(req, res);

    expect(json).toHaveBeenCalledWith(expect.objectContaining({ newScore: 515 }));
  });

  it('clamps the new score at 850', async () => {
    mockQuery.mockResolvedValue({ rows: [{ current_score: 840 }] });

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
