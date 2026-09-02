import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';

type MockQueryResult = { rows: Record<string, unknown>[]; rowCount: number };

const mockQuery: jest.MockedFunction<
  (sql: string, params?: unknown[]) => Promise<MockQueryResult>
> = jest.fn();

jest.unstable_mockModule('../db/connection.js', () => ({
  query: mockQuery,
  getClient: jest.fn(),
}));

const { listLoanDisputes } = await import('../controllers/adminDisputeController.js');
const { encodeCursor } = await import('../utils/pagination.js');

const flushAsync = async (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const createMockResponse = (): Response =>
  ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  }) as unknown as Response;

function disputeRow(id: number, status: string, created_at: string, seq = id) {
  return {
    id,
    loan_id: 100 + id,
    borrower: 'GBORROWER',
    status,
    reason: 'Test reason',
    created_at,
    seq,
  };
}

// Wires the three sequential queries the controller issues when no snapshot_seq
// is supplied: pin MAX(seq), fetch the page, then count the total at that snapshot.
function mockQuerySequence(options: {
  dataRows: Record<string, unknown>[];
  maxSeq?: number;
  totalCount?: number;
}) {
  const { dataRows, maxSeq = 1000, totalCount = dataRows.length } = options;
  mockQuery.mockImplementation(async (sql: string) => {
    if (sql.includes('MAX(seq)')) {
      return { rows: [{ max_seq: maxSeq }], rowCount: 1 };
    }
    if (sql.includes('COUNT(*)')) {
      return { rows: [{ count: String(totalCount) }], rowCount: 1 };
    }
    return { rows: dataRows, rowCount: dataRows.length };
  });
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
    mockQuerySequence({ dataRows: rows, maxSeq: 500, totalCount: 3 });

    const req = { query: {} } as unknown as Request;
    const res = createMockResponse();
    const next = jest.fn<(err?: unknown) => void>();

    listLoanDisputes(req, res, next as unknown as NextFunction);
    await flushAsync();

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: { items: rows },
        page: expect.objectContaining({
          limit: 50,
          next_cursor: null,
          snapshot_seq: '500',
          total_at_snapshot: 3,
        }),
      }),
    );
  });

  it('returns next_cursor when there are more results than limit', async () => {
    const rows = Array.from({ length: 51 }, (_, i) =>
      disputeRow(
        100 - i,
        'open',
        new Date(2026, 4, 28, 10, 0, 0, -i * 60_000).toISOString(),
        100 - i,
      ),
    );
    mockQuerySequence({ dataRows: rows, totalCount: 51 });

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
      disputeRow(i, 'open', new Date(2026, 4, 28, 10, 0, 0, -i * 60_000).toISOString(), i),
    );
    mockQuerySequence({ dataRows: rows, totalCount: 100 });

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
    mockQuerySequence({ dataRows: rows, totalCount: 1 });

    const req = { query: { status: 'resolved' } } as unknown as Request;
    const res = createMockResponse();
    const next = jest.fn<(err?: unknown) => void>();

    listLoanDisputes(req, res, next as unknown as NextFunction);
    await flushAsync();

    // Verify the data-fetch query includes the status filter
    const dataCall = mockQuery.mock.calls.find(
      (call) => call[0].includes('SELECT * FROM loan_disputes') && !call[0].includes('COUNT'),
    );
    expect(dataCall?.[0]).toContain('WHERE status = $1');
    expect(dataCall?.[1]).toEqual(expect.arrayContaining(['resolved']));
  });

  it('includes all statuses when status=all', async () => {
    const rows = [
      disputeRow(3, 'open', '2026-05-28T10:00:00.000Z'),
      disputeRow(2, 'resolved', '2026-05-27T10:00:00.000Z'),
      disputeRow(1, 'rejected', '2026-05-26T10:00:00.000Z'),
    ];
    mockQuerySequence({ dataRows: rows, totalCount: 3 });

    const req = { query: { status: 'all' } } as unknown as Request;
    const res = createMockResponse();
    const next = jest.fn<(err?: unknown) => void>();

    listLoanDisputes(req, res, next as unknown as NextFunction);
    await flushAsync();

    // No WHERE status clause when status=all
    const dataCall = mockQuery.mock.calls.find(
      (call) => call[0].includes('SELECT * FROM loan_disputes') && !call[0].includes('COUNT'),
    );
    expect(dataCall?.[0]).toEqual(expect.not.stringContaining('WHERE status'));
  });

  it('uses cursor pagination when cursor is provided', async () => {
    const rows = [
      disputeRow(2, 'open', '2026-05-27T10:00:00.000Z'),
      disputeRow(1, 'open', '2026-05-26T10:00:00.000Z'),
    ];
    mockQuerySequence({ dataRows: rows, totalCount: 2 });

    const cursor = encodeCursor(new Date('2026-05-28T10:00:00.000Z'), BigInt(3));

    const req = {
      query: { cursor },
    } as unknown as Request;
    const res = createMockResponse();
    const next = jest.fn<(err?: unknown) => void>();

    listLoanDisputes(req, res, next as unknown as NextFunction);
    await flushAsync();

    const dataCall = mockQuery.mock.calls.find(
      (call) => call[0].includes('SELECT * FROM loan_disputes') && !call[0].includes('COUNT'),
    );
    // status=open (default) is $1, snapshot is $2, so the keyset seek starts at $3
    expect(dataCall?.[0]).toContain('created_at < $3');
    expect(dataCall?.[1]).toEqual(expect.arrayContaining(['2026-05-28T10:00:00.000Z']));
  });

  it('orders newest-first by default', async () => {
    mockQuerySequence({ dataRows: [], totalCount: 0 });

    const req = { query: {} } as unknown as Request;
    const res = createMockResponse();
    const next = jest.fn<(err?: unknown) => void>();

    listLoanDisputes(req, res, next as unknown as NextFunction);
    await flushAsync();

    const dataCall = mockQuery.mock.calls.find(
      (call) => call[0].includes('SELECT * FROM loan_disputes') && !call[0].includes('COUNT'),
    );
    expect(dataCall?.[0]).toContain('ORDER BY created_at DESC');
  });
});
