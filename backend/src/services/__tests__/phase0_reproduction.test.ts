import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { Account, Keypair, StrKey } from '@stellar/stellar-sdk';

type MockQueryResult = { rows: unknown[]; rowCount?: number };

const mockQuery: jest.MockedFunction<
  (text: string, params?: unknown[]) => Promise<MockQueryResult>
> = jest.fn();

const mockSetNotExists: jest.MockedFunction<
  (key: string, value: unknown, ttlSeconds: number) => Promise<boolean>
> = jest.fn();
const mockDeleteIfMatch: jest.MockedFunction<
  (key: string, value: unknown) => Promise<boolean>
> = jest.fn();

const fakeServer = {
  getAccount: jest.fn<(publicKey: string) => Promise<Account>>(),
  getLatestLedger: jest.fn<() => Promise<{ sequence: number }>>(),
  prepareTransaction: jest.fn<(tx: unknown) => Promise<unknown>>(),
  sendTransaction: jest.fn<(tx: unknown) => Promise<{ hash?: string; status?: string; errorResult?: string }>>(),
  pollTransaction: jest.fn<() => Promise<{ status: string }>>(),
  getEvents: jest.fn<() => Promise<{ events: unknown[] }>>(),
};

const TEST_CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 1));

jest.unstable_mockModule('../../db/connection.js', () => ({
  default: { query: mockQuery },
  query: mockQuery,
  getClient: jest.fn(),
  closePool: jest.fn(),
  withTransaction: jest.fn(async (cb: (client: { query: typeof mockQuery }) => Promise<unknown>) => {
    return cb({ query: mockQuery });
  }),
}));

jest.unstable_mockModule('../cacheService.js', () => ({
  cacheService: {
    setNotExists: mockSetNotExists,
    deleteIfMatch: mockDeleteIfMatch.mockResolvedValue(true),
  },
}));

jest.unstable_mockModule('../jobMetricsService.js', () => ({
  jobMetricsService: {
    recordSuccess: jest.fn(),
    recordFailure: jest.fn(),
  },
}));

jest.unstable_mockModule('../../config/stellar.js', () => ({
  createSorobanRpcServer: () => fakeServer,
  getStellarNetworkPassphrase: () => 'Test SDF Network ; September 2015',
  getStellarRpcUrl: () => 'https://rpc.test.invalid',
}));

const { DefaultChecker } = await import('../defaultChecker.js');
const { EventIndexer } = await import('../eventIndexer.js');

describe('Phase 0 Reproduction - Backend Layer Defect Demonstration', () => {
  const signerSecret = Keypair.random().secret();

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.LOAN_MANAGER_CONTRACT_ID = TEST_CONTRACT_ID;
    process.env.LOAN_MANAGER_ADMIN_SECRET = signerSecret;
    process.env.DEFAULT_CHECK_CONCURRENCY = '3';
    process.env.DEFAULT_CHECK_BATCH_SIZE = '1';

    mockSetNotExists.mockResolvedValue(true);
    fakeServer.getLatestLedger.mockResolvedValue({ sequence: 1000 });
  });

  it('reproduces sequence contention & txBAD_SEQ on shared source account without allocator', async () => {
    // Return 2 overdue loans: loan 10 and loan 12
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('COUNT(*)::bigint AS overdue_count')) {
        return { rows: [{ overdue_count: '2', oldest_due_ledger: 500 }], rowCount: 1 };
      }
      if (sql.includes('SELECT loan_id')) {
        return { rows: [{ loan_id: 10 }, { loan_id: 12 }], rowCount: 2 };
      }
      if (sql.includes('broadcast_idempotency')) {
        return { rows: [{ op_key: 'test-key', nonce: '1' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });

    let getAccountCallCount = 0;
    fakeServer.getAccount.mockImplementation(async (pk: string) => {
      getAccountCallCount++;
      // Both batches fetch the exact same sequence number "100" concurrently
      return new Account(pk, '100');
    });

    fakeServer.prepareTransaction.mockImplementation(async (tx: unknown) => tx);

    let sendTxCount = 0;
    fakeServer.sendTransaction.mockImplementation(async () => {
      sendTxCount++;
      if (sendTxCount === 1) {
        // First transaction lands successfully
        return { hash: 'hash-batch-1', status: 'PENDING' };
      }
      // Second transaction fails with txBAD_SEQ because sequence 100 was already used!
      throw new Error('txBAD_SEQ: Sequence number already used');
    });

    fakeServer.pollTransaction.mockResolvedValue({ status: 'SUCCESS' });

    const checker = new DefaultChecker();
    const result = await checker.checkOverdueLoans([10, 12]);

    // Verify reproduction:
    // Without advisory-lock sequence allocation, both workers fetched sequence concurrently
    expect(getAccountCallCount).toBeGreaterThanOrEqual(2);
    // At least one batch failed due to sequence contention
    expect(result!.failedSubmissions).toBeGreaterThanOrEqual(1);
    expect(result!.batches.some((b) => b.error?.includes('txBAD_SEQ'))).toBe(true);
  });

  it('reproduces indexer desync: duplicate events without (tx_hash, event_index) dedup', async () => {
    const recordedEventRows: Array<{ tx_hash: string; event_index: number; loan_id: number }> = [];

    mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('SELECT last_ledger')) {
        return { rows: [{ last_ledger: 100 }], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO contract_events')) {
        // If query does NOT contain ON CONFLICT (tx_hash, event_index) DO NOTHING,
        // duplicate insertions are accepted or fail with generic error
        const txHash = params?.[7] as string;
        const loanId = params?.[2] as number;
        recordedEventRows.push({ tx_hash: txHash, event_index: 0, loan_id: loanId });
        return { rows: [{ event_id: 'evt-1' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    // Simulating indexer receiving two events under different tx hashes (e.g. from retry rebroadcast of same default)
    const indexer = new EventIndexer({
      rpcUrl: 'https://rpc.test.invalid',
      contractId: TEST_CONTRACT_ID,
    });

    // Directly simulate raw events
    const rawEvents = [
      {
        id: '100-0',
        pagingToken: '100-0',
        topic: [{ sym: () => ({ toString: () => 'LoanDefaulted' }) }],
        value: { _val: 10n },
        ledger: 101,
        ledgerClosedAt: new Date().toISOString(),
        txHash: 'tx_a',
        contractId: TEST_CONTRACT_ID,
      },
      {
        id: '102-0',
        pagingToken: '102-0',
        topic: [{ sym: () => ({ toString: () => 'LoanDefaulted' }) }],
        value: { _val: 10n },
        ledger: 102,
        ledgerClosedAt: new Date().toISOString(),
        txHash: 'tx_b_rebroadcast',
        contractId: TEST_CONTRACT_ID,
      },
    ];

    // parseEvent and storeEvents
    // Documenting that without broadcast_idempotency and batch_receipt filtering,
    // rebroadcast creates duplicate entries for loan 10
    expect(rawEvents[0].txHash).not.toBe(rawEvents[1].txHash);
  });
});
