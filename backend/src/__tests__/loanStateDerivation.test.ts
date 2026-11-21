import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { Request, Response } from 'express';

type MockQueryResult = { rows: Record<string, unknown>[]; rowCount: number };

const mockQuery: jest.MockedFunction<
  (sql: string, params?: unknown[]) => Promise<MockQueryResult>
> = jest.fn();

jest.unstable_mockModule('../db/connection.js', () => ({
  query: mockQuery,
  getClient: jest.fn(),
  withAdvisoryLock: jest.fn(),
}));

const { getLoanSummary } = await import('../utils/loanState.js');
const { getLoanDispute } = await import('../controllers/adminDisputeController.js');

const flushAsync = async (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const createMockResponse = (): Response =>
  ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  }) as unknown as Response;

describe('loan state is derived from contract_events (no `loans` table)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('getLoanSummary reads contract_events and never the loans table', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ loan_id: 7, status: 'PENDING', borrower: 'GB' }],
      rowCount: 1,
    });

    const summary = await getLoanSummary(7);

    expect(summary).toMatchObject({ loan_id: 7, status: 'PENDING' });
    const [sql, params] = mockQuery.mock.calls[0]!;
    expect(sql).toMatch(/FROM\s+contract_events/i);
    expect(sql).not.toMatch(/\bFROM\s+loans\b/i);
    expect(sql).not.toMatch(/\bJOIN\s+loans\b/i);
    expect(params).toEqual([7]);
  });

  it('getLoanSummary returns null when the loan has no events', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect(getLoanSummary(999)).resolves.toBeNull();
  });

  it('getLoanDispute returns the dispute with its derived loan', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 3, loan_id: 42, status: 'open', borrower: 'GB' }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [{ loan_id: 42, status: 'DEFAULTED', borrower: 'GB' }],
        rowCount: 1,
      });

    const res = createMockResponse();
    const next = jest.fn();
    getLoanDispute({ params: { disputeId: '3' } } as unknown as Request, res, next);
    await flushAsync();

    expect(next).not.toHaveBeenCalled();
    for (const [sql] of mockQuery.mock.calls) {
      expect(sql).not.toMatch(/\b(FROM|JOIN)\s+loans\b/i);
    }
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      dispute: {
        id: 3,
        loan_id: 42,
        status: 'open',
        borrower: 'GB',
        loan: { loan_id: 42, status: 'DEFAULTED', borrower: 'GB' },
      },
    });
  });

  it('getLoanDispute 404s when the dispute does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = createMockResponse();
    const next = jest.fn();
    getLoanDispute({ params: { disputeId: '404' } } as unknown as Request, res, next);
    await flushAsync();

    expect(next).toHaveBeenCalledTimes(1);
    expect((next.mock.calls[0]![0] as { statusCode?: number }).statusCode).toBe(404);
  });
});
