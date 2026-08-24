import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';
import { encodeCursor } from '../utils/pagination.js';

type MockQueryResult = { rows: Record<string, unknown>[]; rowCount: number };

const mockQuery: jest.MockedFunction<
  (sql: string, params?: unknown[]) => Promise<MockQueryResult>
> = jest.fn();

jest.unstable_mockModule('../db/connection.js', () => ({
  query: mockQuery,
  getClient: jest.fn(),
}));

const { listLoanDisputes } = await import('../controllers/adminDisputeController.js');

const flushAsync = async (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const createMockResponse = (): Response =>
  ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  }) as unknown as Response;

function disputeRow(id: number, status: string, created_at: string) {
  return {
    id,
    seq: id,
    loan_id: 100 + id,
    borrower: 'GBORROWER',
    status,
    reason: 'Test reason',
    created_at,
  };
}

describe('listLoanDisputes pagination', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns disputes with default limit and status=open', async () => {
    const rows = [
      disputeRow(3, 'open', '2026-05-28T10:00:00.000Z'),
      disputeRow(2, 'open', '2026-05-27T10:00:00.000Z'),
      disputeRow(1, 'open', '2026-05-26T10:00:00.000Z'),
    ];
    mockQuery
      .mockResolvedValueOnce({ rows: [{ max_seq: '3' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows, rowCount: 3 })
      .mockResolvedValueOnce({ rows: [{ count: '3' }], rowCount: 1 });

    const req = { query: {} } as unknown as Request;
    const res = createMockResponse();
    const next = jest.fn<(err?: unknown) => void>();

    listLoanDisputes(req, res, next as unknown as NextFunction);
    await flushAsync();

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        page: expect.objectContaining({
          limit: 50,
          next_cursor: null,
        }),
      }),
    );
  });

  it('returns next_cursor when there are more results than limit', async () => {
    const rows = Array.from({ length: 51 }, (_, i) =>
      disputeRow(100 - i, 'open', new Date(2026, 4, 28, 10, 0, 0, -i * 60_000).toISOString()),
    );
    mockQuery
      .mockResolvedValueOnce({ rows: [{ max_seq: '100' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows, rowCount: 51 })
      .mockResolvedValueOnce({ rows: [{ count: '51' }], rowCount: 1 });

    const req = { query: {} } as unknown as Request;
    const res = createMockResponse();
    const next = jest.fn<(err?: unknown) => void>();

    listLoanDisputes(req, res, next as unknown as NextFunction);
    await flushAsync();

    const jsonCall = (res.json as jest.Mock).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(jsonCall.success).toBe(true);
    const page = jsonCall.page as Record<string, unknown>;
    expect(typeof page.next_cursor).toBe('string');
    const data = jsonCall.data as { items: unknown[] };
    expect(data.items.length).toBe(50);
  });

  it('enforces max page size (capped at 100)', async () => {
    const rows = Array.from({ length: 100 }, (_, i) =>
      disputeRow(i + 1, 'open', new Date(2026, 4, 28, 10, 0, 0, -i * 60_000).toISOString()),
    );
    mockQuery
      .mockResolvedValueOnce({ rows: [{ max_seq: '100' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows, rowCount: 100 })
      .mockResolvedValueOnce({ rows: [{ count: '100' }], rowCount: 1 });

    const req = { query: { limit: '500' } } as unknown as Request;
    const res = createMockResponse();
    const next = jest.fn<(err?: unknown) => void>();

    listLoanDisputes(req, res, next as unknown as NextFunction);
    await flushAsync();

    const jsonCall = (res.json as jest.Mock).mock.calls[0]?.[0] as Record<string, unknown>;
    const page = jsonCall.page as Record<string, unknown>;
    // limit should be capped at 100
    expect(page.limit).toBe(100);
  });

  it('filters by status correctly', async () => {
    const rows = [disputeRow(1, 'resolved', '2026-05-28T10:00:00.000Z')];
    mockQuery
      .mockResolvedValueOnce({ rows: [{ max_seq: '1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows, rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ count: '1' }], rowCount: 1 });

    const req = { query: { status: 'resolved' } } as unknown as Request;
    const res = createMockResponse();
    const next = jest.fn<(err?: unknown) => void>();

    listLoanDisputes(req, res, next as unknown as NextFunction);
    await flushAsync();

    // Verify SQL includes status filter
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('status = $1'),
      expect.arrayContaining(['resolved']),
    );
  });

  it('includes all statuses when status=all', async () => {
    const rows = [
      disputeRow(3, 'open', '2026-05-28T10:00:00.000Z'),
      disputeRow(2, 'resolved', '2026-05-27T10:00:00.000Z'),
      disputeRow(1, 'rejected', '2026-05-26T10:00:00.000Z'),
    ];
    mockQuery
      .mockResolvedValueOnce({ rows: [{ max_seq: '3' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows, rowCount: 3 })
      .mockResolvedValueOnce({ rows: [{ count: '3' }], rowCount: 1 });

    const req = { query: { status: 'all' } } as unknown as Request;
    const res = createMockResponse();
    const next = jest.fn<(err?: unknown) => void>();

    listLoanDisputes(req, res, next as unknown as NextFunction);
    await flushAsync();

    // No WHERE status condition
    expect(mockQuery.mock.calls[1]?.[0]).not.toContain('status = $1');
  });

  it('uses cursor pagination when cursor is provided', async () => {
    const rows = [
      disputeRow(2, 'open', '2026-05-27T10:00:00.000Z'),
      disputeRow(1, 'open', '2026-05-26T10:00:00.000Z'),
    ];
    mockQuery
      .mockResolvedValueOnce({ rows, rowCount: 2 })
      .mockResolvedValueOnce({ rows: [{ count: '2' }], rowCount: 1 });

    const cursor = encodeCursor(new Date('2026-05-28T10:00:00.000Z'), BigInt(10));
    const req = {
      query: { cursor, snapshot_seq: '100' },
    } as unknown as Request;
    const res = createMockResponse();
    const next = jest.fn<(err?: unknown) => void>();

    listLoanDisputes(req, res, next as unknown as NextFunction);
    await flushAsync();

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('created_at < $'),
      expect.arrayContaining(['2026-05-28T10:00:00.000Z']),
    );
  });

  it('orders newest-first by default', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ max_seq: '0' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ count: '0' }], rowCount: 1 });

    const req = { query: {} } as unknown as Request;
    const res = createMockResponse();
    const next = jest.fn<(err?: unknown) => void>();

    listLoanDisputes(req, res, next as unknown as NextFunction);
    await flushAsync();

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('ORDER BY created_at DESC'),
      expect.any(Array),
    );
  });
});
