/**
 * Tests for the contiguous-cursor invariant / gap detection added for
 * issue #1376: EventIndexer.recordCheckpoint (called from pollOnce) and
 * EventIndexer.getSuspectRanges.
 *
 * Mocking pattern mirrors eventIndexer.test.ts's ESM module mocks — this
 * suite needs `node --experimental-vm-modules` (the project's `npm test`
 * script already passes it; a bare `npx jest` invocation will not).
 */
import { jest, describe, it, expect, beforeAll, beforeEach } from '@jest/globals';

let mockQuery: jest.Mock<(...args: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>>;
let EventIndexer: new (config: { rpcUrl: string; contractIds?: string[] }) => {
  getSuspectRanges: () => Promise<Array<{ rangeStart: number; rangeEnd: number }>>;
  pollOnce: () => Promise<void>;
  running: boolean;
  rpc: { getEvents: unknown; getLatestLedger: unknown };
};
let hasUnresolvedLedgerGaps: (contract: string) => Promise<boolean>;

beforeAll(async () => {
  mockQuery = jest
    .fn<(...args: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>>()
    .mockResolvedValue({ rows: [], rowCount: 0 } as never);

  jest.unstable_mockModule('../../db/connection.js', () => ({
    query: mockQuery,
    getClient: jest.fn(),
    withTransaction: jest.fn(),
    TRANSIENT_ERROR_CODES: new Set(['08006', '57P01', '40001']),
  }));

  jest.unstable_mockModule('../scoresService.js', () => ({
    updateUserScoresBulk: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  }));

  jest.unstable_mockModule('../sorobanService.js', () => ({
    sorobanService: {
      getScoreConfig: jest
        .fn<() => { repaymentDelta: number; defaultPenalty: number }>()
        .mockReturnValue({ repaymentDelta: 10, defaultPenalty: 20 }),
    },
  }));

  jest.unstable_mockModule('../webhookService.js', () => ({
    webhookService: { dispatch: jest.fn<() => Promise<void>>().mockResolvedValue(undefined) },
    SUPPORTED_WEBHOOK_EVENT_TYPES: [],
  }));

  jest.unstable_mockModule('../eventStreamService.js', () => ({
    eventStreamService: { broadcast: jest.fn() },
  }));

  jest.unstable_mockModule('../notificationService.js', () => ({
    notificationService: {
      createNotification: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    },
  }));

  jest.unstable_mockModule('../../utils/logger.js', () => ({
    default: {
      warn: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
      withContext: jest.fn().mockReturnValue({
        warn: jest.fn(),
        error: jest.fn(),
        info: jest.fn(),
        debug: jest.fn(),
      }),
    },
  }));

  jest.unstable_mockModule('../../utils/requestContext.js', () => ({
    createRequestId: jest.fn().mockReturnValue('test-req-id'),
    runWithRequestContext: jest.fn((_id: string, fn: () => Promise<unknown>) => fn()),
  }));

  jest.unstable_mockModule('@stellar/stellar-sdk', () => ({
    rpc: {
      Server: jest.fn<(...args: unknown[]) => unknown>().mockImplementation(() => ({
        getEvents: jest
          .fn<() => Promise<{ events: unknown[] }>>()
          .mockResolvedValue({ events: [] } as never),
        getLatestLedger: jest
          .fn<() => Promise<{ sequence: number }>>()
          .mockResolvedValue({ sequence: 0 } as never),
      })),
    },
    scValToNative: jest.fn(),
    xdr: { ScVal: {} as never },
  }));

  jest.unstable_mockModule('../../errors/AppError.js', () => ({
    AppError: { badRequest: (msg: string) => new Error(msg) },
  }));

  const mod = await import('../eventIndexer.js');
  EventIndexer = (mod as unknown as { EventIndexer: typeof EventIndexer }).EventIndexer;
  hasUnresolvedLedgerGaps = (
    mod as unknown as { hasUnresolvedLedgerGaps: typeof hasUnresolvedLedgerGaps }
  ).hasUnresolvedLedgerGaps;
});

beforeEach(() => {
  jest.clearAllMocks();
});

function makeIndexer() {
  return new EventIndexer({
    rpcUrl: 'http://localhost:8000',
    contractIds: ['CONTRACT001'],
  });
}

describe('EventIndexer gap detection (contiguous-cursor invariant, #1376)', () => {
  it('records a verified checkpoint on the very first poll (nothing prior to compare against)', async () => {
    const inserted: Array<{ sql: string; params: unknown[] }> = [];

    mockQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('SELECT last_ledger')) return { rows: [{ last_ledger: 0 }], rowCount: 1 };
      if (sql.includes('FROM ledger_checkpoints')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('INSERT INTO ledger_checkpoints')) {
        inserted.push({ sql, params });
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('UPDATE indexer_state') || sql.includes('INSERT INTO indexer_state')) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const indexer = makeIndexer();
    indexer.running = true;
    indexer.rpc = {
      getLatestLedger: async () => ({ sequence: 10 }),
      getEvents: async () => ({ events: [] }),
    };

    await indexer.pollOnce();

    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.sql).toContain("'verified'");
    expect(inserted[0]?.params).toEqual(['CONTRACT001', 1, 10]);
  });

  it('records a contiguous verified checkpoint with no gap when the new range immediately follows the previous one', async () => {
    const inserted: Array<{ sql: string; params: unknown[] }> = [];

    mockQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('SELECT last_ledger')) return { rows: [{ last_ledger: 10 }], rowCount: 1 };
      if (sql.includes('FROM ledger_checkpoints')) {
        return { rows: [{ range_end: 10 }], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO ledger_checkpoints')) {
        inserted.push({ sql, params });
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });

    const indexer = makeIndexer();
    indexer.running = true;
    indexer.rpc = {
      getLatestLedger: async () => ({ sequence: 20 }),
      getEvents: async () => ({ events: [] }),
    };

    await indexer.pollOnce();

    // Contiguous — exactly one insert (the new verified range), no suspect gap row.
    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.sql).toContain("'verified'");
    expect(inserted[0]?.params).toEqual(['CONTRACT001', 11, 20]);
  });

  it('flags a suspect gap when the new range does not immediately follow the previous checkpoint', async () => {
    const inserted: Array<{ sql: string; params: unknown[] }> = [];

    mockQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      // lastIndexedLedger is stale/clamped ahead — this is the exact
      // scenario from the issue's walkthrough: indexer_state says we're
      // caught up to 1000, but the last verified checkpoint only covers
      // up to ledger 999... no — model it as: indexer_state (last_ledger)
      // has jumped ahead to 1039 (simulating a clamp to RPC retention
      // floor) while the checkpoint history only confirms up to 1000.
      if (sql.includes('SELECT last_ledger')) return { rows: [{ last_ledger: 1039 }], rowCount: 1 };
      if (sql.includes('FROM ledger_checkpoints')) {
        return { rows: [{ range_end: 1000 }], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO ledger_checkpoints')) {
        inserted.push({ sql, params });
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });

    const indexer = makeIndexer();
    indexer.running = true;
    indexer.rpc = {
      getLatestLedger: async () => ({ sequence: 1060 }),
      getEvents: async () => ({ events: [] }),
    };

    await indexer.pollOnce();

    // Two inserts: the suspect gap [1001, 1039], then the verified new range.
    expect(inserted).toHaveLength(2);
    expect(inserted[0]?.sql).toContain("'suspect'");
    expect(inserted[0]?.params).toEqual(['CONTRACT001', 1001, 1039]);
    expect(inserted[1]?.sql).toContain("'verified'");
    expect(inserted[1]?.params).toEqual(['CONTRACT001', 1040, 1060]);
  });

  it('getSuspectRanges returns only suspect ranges for this contract, oldest first', async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("status = 'suspect'")) {
        return {
          rows: [
            { range_start: 1001, range_end: 1039 },
            { range_start: 2001, range_end: 2010 },
          ],
          rowCount: 2,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const indexer = makeIndexer();
    const ranges = await indexer.getSuspectRanges();

    expect(ranges).toEqual([
      { rangeStart: 1001, rangeEnd: 1039 },
      { rangeStart: 2001, rangeEnd: 2010 },
    ]);
  });
});

describe('hasUnresolvedLedgerGaps (consumer-side gate, #1376)', () => {
  it('returns true when the contract has a suspect ledger range', async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('has_suspect')) {
        return { rows: [{ has_suspect: true }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    await expect(hasUnresolvedLedgerGaps('CONTRACT001')).resolves.toBe(true);
  });

  it('returns false when no suspect ranges exist for the contract', async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('has_suspect')) {
        return { rows: [{ has_suspect: false }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    await expect(hasUnresolvedLedgerGaps('CONTRACT001')).resolves.toBe(false);
  });

  it('fails open (returns false) when the checkpoint query throws', async () => {
    mockQuery.mockImplementation(async () => {
      throw new Error('connection refused');
    });

    await expect(hasUnresolvedLedgerGaps('CONTRACT001')).resolves.toBe(false);
  });
});
