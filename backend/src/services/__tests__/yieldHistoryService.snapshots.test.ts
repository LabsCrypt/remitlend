import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockQuery = jest.fn<(sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>>();

jest.unstable_mockModule('../../db/connection.js', () => ({
  withAdvisoryLock: async (_key: string, fn: () => Promise<unknown>) => fn(),
  query: mockQuery,
}));

const { buildDepositorYieldHistory, MAX_POINTS } = await import('../yieldHistoryService.js');

const NOW = new Date('2026-06-10T12:34:56.000Z');
const POOL_CONTRACT_ID = 'CPoolContract';
const DEPOSITOR = 'GDepositor';
const TOKEN = 'GToken';

type EventRow = {
  event_type: string;
  amount: string;
  ledger_closed_at: string;
  value: string | null;
};

function event(eventType: string, amount: string, at: string): EventRow {
  return { event_type: eventType, amount, ledger_closed_at: at, value: null };
}

function setEvents(poolEvents: EventRow[], depositorEvents: EventRow[]) {
  mockQuery.mockResolvedValueOnce({ rows: poolEvents });
  mockQuery.mockResolvedValueOnce({ rows: depositorEvents });
}

describe('yield history snapshot gaps (#2084)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    jest.clearAllMocks();
    process.env.LENDING_POOL_CONTRACT_ID = POOL_CONTRACT_ID;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('values a depositor with no pool snapshot at zero and trims leading empty buckets', async () => {
    setEvents([], [event('Deposit', '1000', '2026-06-05T00:00:00.000Z')]);

    const history = await buildDepositorYieldHistory(DEPOSITOR, TOKEN, 7);

    expect(history).toHaveLength(6);
    expect(history[0]!.timestamp).toBe('2026-06-05T00:00:00.000Z');
    expect(history.at(-1)!.timestamp).toBe('2026-06-10T00:00:00.000Z');
    for (const point of history) {
      expect(point).toEqual({
        timestamp: point.timestamp,
        depositedValue: 1000,
        currentValue: 0,
        netYield: -1000,
      });
    }
  });

  it('queries the pool snapshot and the depositor with the pinned lookback boundary', async () => {
    setEvents([], [event('Deposit', '1000', '2026-06-05T00:00:00.000Z')]);

    await buildDepositorYieldHistory(DEPOSITOR, TOKEN, 7);

    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery.mock.calls[0]![0]).toContain('contract_id = $1');
    expect(mockQuery.mock.calls[0]![1]).toEqual([POOL_CONTRACT_ID, '2026-06-03T12:34:56.000Z']);
    expect(mockQuery.mock.calls[1]![0]).toContain('address = $1');
    expect(mockQuery.mock.calls[1]![1]).toEqual([DEPOSITOR, '2026-06-03T12:34:56.000Z']);
  });

  it('uses the on-chain share price only on the final bucket when snapshots are missing', async () => {
    setEvents([], [event('Deposit', '1000', '2026-06-05T00:00:00.000Z')]);

    const history = await buildDepositorYieldHistory(DEPOSITOR, TOKEN, 7, 1_200_000);

    expect(history.at(-1)).toEqual({
      timestamp: '2026-06-10T00:00:00.000Z',
      depositedValue: 1000,
      currentValue: 1200,
      netYield: 200,
    });
    expect(history[0]!.currentValue).toBe(0);
  });

  it('aggregates events that share the same date into one point', async () => {
    setEvents(
      [
        event('Deposit', '1000', '2026-06-05T00:00:00.000Z'),
        event('Deposit', '500', '2026-06-05T00:00:00.000Z'),
        event('YieldDistributed', '150', '2026-06-06T00:00:00.000Z'),
      ],
      [
        event('Deposit', '1000', '2026-06-05T00:00:00.000Z'),
        event('Deposit', '500', '2026-06-05T00:00:00.000Z'),
      ],
    );

    const history = await buildDepositorYieldHistory(DEPOSITOR, TOKEN, 7);

    expect(history).toHaveLength(6);
    expect(new Set(history.map((point) => point.timestamp)).size).toBe(6);
    expect(history[0]).toEqual({
      timestamp: '2026-06-05T00:00:00.000Z',
      depositedValue: 1500,
      currentValue: 1500,
      netYield: 0,
    });
    expect(history[1]).toEqual({
      timestamp: '2026-06-06T00:00:00.000Z',
      depositedValue: 1500,
      currentValue: 1650,
      netYield: 150,
    });
    expect(history.at(-1)!.currentValue).toBe(1650);
  });

  it('guards division by zero when a drained pool still has shares in the snapshot', async () => {
    setEvents(
      [
        event('Deposit', '1000', '2026-06-05T00:00:00.000Z'),
        event('Withdraw', '1000', '2026-06-05T00:00:00.000Z'),
      ],
      [event('Deposit', '1000', '2026-06-05T00:00:00.000Z')],
    );

    const history = await buildDepositorYieldHistory(DEPOSITOR, TOKEN, 7);

    expect(history).toHaveLength(6);
    for (const point of history) {
      expect(point.currentValue).toBe(0);
    }
    expect(history.at(-1)!.netYield).toBe(-1000);
  });

  it('returns no history when the pool and the depositor are both empty', async () => {
    setEvents(
      [
        event('Deposit', '1000', '2026-06-05T00:00:00.000Z'),
        event('Withdraw', '1000', '2026-06-05T00:00:00.000Z'),
      ],
      [
        event('Deposit', '1000', '2026-06-05T00:00:00.000Z'),
        event('Withdraw', '1000', '2026-06-05T00:00:00.000Z'),
      ],
    );

    await expect(buildDepositorYieldHistory(DEPOSITOR, TOKEN, 7)).resolves.toEqual([]);
  });

  it('caps the 90-day window at MAX_POINTS daily buckets', async () => {
    setEvents(
      [event('Deposit', '1000', '2026-03-12T00:00:00.000Z')],
      [event('Deposit', '1000', '2026-03-12T00:00:00.000Z')],
    );

    const history = await buildDepositorYieldHistory(DEPOSITOR, TOKEN, 90);

    expect(MAX_POINTS).toBe(90);
    expect(history).toHaveLength(90);
    expect(history[0]!.timestamp).toBe('2026-03-12T00:00:00.000Z');
    expect(history.at(-1)!.timestamp).toBe('2026-06-09T00:00:00.000Z');
  });

  it('propagates snapshot query failures with the original error contract', async () => {
    const failure = new Error('snapshot query failed');
    mockQuery.mockRejectedValueOnce(failure).mockResolvedValueOnce({ rows: [] });

    await expect(buildDepositorYieldHistory(DEPOSITOR, TOKEN, 7)).rejects.toBe(failure);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });
});
