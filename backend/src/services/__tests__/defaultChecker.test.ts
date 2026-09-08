import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { Account, Keypair, StrKey } from '@stellar/stellar-sdk';

type MockQueryResult = { rows: unknown[]; rowCount?: number };

const mockQuery: jest.MockedFunction<
  (text: string, params?: unknown[]) => Promise<MockQueryResult>
> = jest.fn();

const mockSetNotExists: jest.MockedFunction<
  (key: string, value: unknown, ttlSeconds: number) => Promise<boolean>
> = jest.fn();
const mockDelete: jest.MockedFunction<(key: string) => Promise<void>> = jest.fn();
const mockDeleteIfMatch: jest.MockedFunction<(key: string, value: unknown) => Promise<boolean>> =
  jest.fn();

const mockRecordSuccess = jest.fn();
const mockRecordFailure = jest.fn();

const fakeServer = {
  getAccount: jest.fn<(publicKey: string) => Promise<Account>>(),
  getLatestLedger: jest.fn<() => Promise<{ sequence: number }>>(),
  prepareTransaction: jest.fn<(tx: unknown) => Promise<unknown>>(),
  sendTransaction: jest.fn<(tx: unknown) => Promise<{ hash?: string; status?: string }>>(),
  pollTransaction: jest.fn<() => Promise<{ status: string }>>(),
};

const TEST_CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 1));

jest.unstable_mockModule('../../db/connection.js', () => ({
  default: { query: mockQuery },
  query: mockQuery,
  getClient: jest.fn(),
  closePool: jest.fn(),
}));

jest.unstable_mockModule('../cacheService.js', () => ({
  cacheService: {
    setNotExists: mockSetNotExists,
    delete: mockDelete,
    // releaseLock() calls deleteIfMatch; route it through mockDelete so the
    // existing test assertions on mockDelete still work.
    deleteIfMatch: mockDeleteIfMatch.mockImplementation(async (key) => {
      await mockDelete(key);
      return true;
    }),
  },
}));

jest.unstable_mockModule('../jobMetricsService.js', () => ({
  jobMetricsService: {
    recordSuccess: mockRecordSuccess,
    recordFailure: mockRecordFailure,
  },
}));

jest.unstable_mockModule('../../config/stellar.js', () => ({
  createSorobanRpcServer: () => fakeServer,
  getStellarNetworkPassphrase: () => 'Test SDF Network ; September 2015',
}));

const { DefaultChecker } = await import('../defaultChecker.js');

const overdueStatsRow = () => ({
  rows: [{ overdue_count: '0', oldest_due_ledger: null }],
});

describe('DefaultChecker', () => {
  const signerSecret = Keypair.random().secret();
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.LOAN_MANAGER_CONTRACT_ID = TEST_CONTRACT_ID;
    process.env.LOAN_MANAGER_ADMIN_SECRET = signerSecret;

    mockQuery.mockResolvedValue(overdueStatsRow());
    fakeServer.getLatestLedger.mockResolvedValue({ sequence: 100 });
    fakeServer.getAccount.mockImplementation(
      async (publicKey: string) => new Account(publicKey, '1'),
    );
  });

  describe('suspect ledger range gate (#1376)', () => {
    it('skips the run without submitting when the indexer has an unresolved ledger gap', async () => {
      mockSetNotExists.mockResolvedValue(true);
      mockQuery.mockImplementation(async (sql: string) => {
        if (sql.includes('has_suspect')) {
          return { rows: [{ has_suspect: true }], rowCount: 1 };
        }
        return overdueStatsRow();
      });

      const checker = new DefaultChecker();
      const result = await checker.checkOverdueLoans([1, 2]);

      expect(result).not.toBeNull();
      expect(result!.skipped).toBe(true);
      expect(result!.skippedReason).toBe('unresolved_ledger_gap');
      expect(result!.loansChecked).toBe(0);
      expect(fakeServer.getLatestLedger).not.toHaveBeenCalled();
      expect(fakeServer.prepareTransaction).not.toHaveBeenCalled();
      expect(mockDelete).toHaveBeenCalledTimes(1);
      expect(mockRecordSuccess).toHaveBeenCalledWith('defaultChecker', expect.any(Number));
    });

    it('proceeds normally when there is no unresolved ledger gap', async () => {
      mockSetNotExists.mockResolvedValue(true);
      fakeServer.prepareTransaction.mockImplementation(async (tx: unknown) => tx);
      fakeServer.sendTransaction.mockResolvedValue({ hash: 'abc', status: 'PENDING' });
      fakeServer.pollTransaction.mockResolvedValue({ status: 'SUCCESS' });
      // mockQuery already resolves has_suspect-less overdueStatsRow() by default.

      const checker = new DefaultChecker();
      const result = await checker.checkOverdueLoans([1, 2]);

      expect(result!.skipped).toBeUndefined();
      expect(fakeServer.getLatestLedger).toHaveBeenCalled();
    });
  });

  describe('acquireLock', () => {
    it('returns null without submitting when the lock is not acquired', async () => {
      mockSetNotExists.mockResolvedValue(false);
      const checker = new DefaultChecker();

      const result = await checker.checkOverdueLoans([1, 2]);

      expect(result).toBeNull();
      expect(mockQuery).not.toHaveBeenCalled();
      expect(fakeServer.prepareTransaction).not.toHaveBeenCalled();
      expect(mockDelete).not.toHaveBeenCalled();
    });
  });

  describe('submission failures', () => {
    beforeEach(() => {
      mockSetNotExists.mockResolvedValue(true);
    });

    it('reports prepareTransaction failures as a batch error instead of throwing', async () => {
      fakeServer.prepareTransaction.mockRejectedValue(new Error('boom'));
      const checker = new DefaultChecker();

      const result = await checker.checkOverdueLoans([1, 2]);

      expect(result).not.toBeNull();
      expect(result!.batches).toHaveLength(1);
      expect(result!.batches[0]!.error).toContain('prepareTransaction failed: boom');
      expect(result!.successfulSubmissions).toBe(0);
      expect(result!.failedSubmissions).toBe(1);
      expect(mockDelete).toHaveBeenCalledTimes(1);
    });

    it('reports sendTransaction failures as a batch error instead of throwing', async () => {
      fakeServer.prepareTransaction.mockImplementation(async (tx: unknown) => tx);
      fakeServer.sendTransaction.mockRejectedValue(new Error('network down'));
      const checker = new DefaultChecker();

      const result = await checker.checkOverdueLoans([1, 2]);

      expect(result!.batches[0]!.error).toContain('sendTransaction failed: network down');
      expect(result!.failedSubmissions).toBe(1);
      expect(result!.successfulSubmissions).toBe(0);
    });

    it('counts successful and failed batches across a multi-batch run', async () => {
      process.env.DEFAULT_CHECK_BATCH_SIZE = '1';
      fakeServer.prepareTransaction.mockImplementation(async (tx: unknown) => tx);
      // First call succeeds, second call fails
      fakeServer.sendTransaction
        .mockResolvedValueOnce({ hash: 'abc', status: 'PENDING' })
        .mockRejectedValueOnce(new Error('rejected'));
      fakeServer.pollTransaction.mockResolvedValue({ status: 'SUCCESS' });

      const checker = new DefaultChecker();
      const result = await checker.checkOverdueLoans([1, 2]);

      expect(result!.batches).toHaveLength(2);
      expect(result!.successfulSubmissions).toBe(1);
      expect(result!.failedSubmissions).toBe(1);
      expect(mockRecordSuccess).toHaveBeenCalledWith('defaultChecker', expect.any(Number));
    });
  });

  describe('batch timeout', () => {
    it('resolves with timedOut: true when a batch exceeds batchTimeoutMs', async () => {
      mockSetNotExists.mockResolvedValue(true);
      process.env.DEFAULT_CHECK_BATCH_TIMEOUT_MS = '20';
      fakeServer.prepareTransaction.mockImplementation(
        () => new Promise(() => {}), // never resolves
      );

      const checker = new DefaultChecker();
      const result = await checker.checkOverdueLoans([1, 2]);

      expect(result!.batches).toHaveLength(1);
      expect(result!.batches[0]!.timedOut).toBe(true);
      expect(result!.failedSubmissions).toBe(1);
      expect(mockDelete).toHaveBeenCalledTimes(1);
    });
  });

  describe('releaseLock', () => {
    it('releases the lock even when the run throws', async () => {
      mockSetNotExists.mockResolvedValue(true);
      delete process.env.LOAN_MANAGER_CONTRACT_ID;

      const checker = new DefaultChecker();

      await expect(checker.checkOverdueLoans([1, 2])).rejects.toThrow('LOAN_MANAGER_CONTRACT_ID');
      expect(mockDelete).toHaveBeenCalledTimes(1);
      expect(mockRecordFailure).toHaveBeenCalledTimes(1);
    });
  });

  describe('sequence number assignment (#1094)', () => {
    // Use a valid Stellar keypair for Account construction
    const validPublicKey = Keypair.random().publicKey();

    beforeEach(() => {
      // Override getAccount to return an account with a known sequence number
      fakeServer.getAccount.mockResolvedValue(new Account(validPublicKey, '42'));
    });

    it('fetches the admin account exactly once per run, not per batch', async () => {
      process.env.DEFAULT_CHECK_BATCH_SIZE = '1';
      mockSetNotExists.mockResolvedValue(true);
      fakeServer.prepareTransaction.mockImplementation(async (tx: unknown) => tx);
      fakeServer.sendTransaction.mockResolvedValue({ hash: 'abc', status: 'PENDING' });
      fakeServer.pollTransaction.mockResolvedValue({ status: 'SUCCESS' });

      const checker = new DefaultChecker();
      await checker.checkOverdueLoans([1, 2, 3]);

      // getAccount should be called once for the initial fetch,
      // NOT once per batch (3 batches at batch_size=1)
      expect(fakeServer.getAccount).toHaveBeenCalledTimes(1);
    });

    it('assigns strictly increasing sequence numbers across batches', async () => {
      process.env.DEFAULT_CHECK_BATCH_SIZE = '1';
      mockSetNotExists.mockResolvedValue(true);

      const preparedTxns: unknown[] = [];
      fakeServer.prepareTransaction.mockImplementation(async (tx: unknown) => {
        preparedTxns.push(tx);
        return tx;
      });
      fakeServer.sendTransaction.mockResolvedValue({ hash: 'abc', status: 'PENDING' });
      fakeServer.pollTransaction.mockResolvedValue({ status: 'SUCCESS' });

      const checker = new DefaultChecker();
      const result = await checker.checkOverdueLoans([1, 2, 3]);

      expect(result).not.toBeNull();
      expect(result!.batches).toHaveLength(3);

      // Extract sequence numbers from prepared transactions.
      // Transaction objects expose a `sequence` property (string).
      const seqNums = preparedTxns.map((tx) => {
        const t = tx as { sequence?: string };
        return t.sequence ?? '';
      });

      // All sequence numbers must be non-empty
      for (const s of seqNums) {
        expect(s).not.toBe('');
      }

      // All sequence numbers must be unique
      const unique = new Set(seqNums);
      expect(unique.size).toBe(seqNums.length);

      // Sequence numbers must be strictly increasing (43, 44, 45)
      for (let i = 1; i < seqNums.length; i++) {
        expect(BigInt(seqNums[i]!)).toBeGreaterThan(BigInt(seqNums[i - 1]!));
      }
    });

    it('succeeds with all batches when concurrency > 1 and batch size creates multiple batches', async () => {
      process.env.DEFAULT_CHECK_BATCH_SIZE = '2';
      process.env.DEFAULT_CHECK_CONCURRENCY = '3';
      mockSetNotExists.mockResolvedValue(true);
      fakeServer.prepareTransaction.mockImplementation(async (tx: unknown) => tx);
      fakeServer.sendTransaction.mockResolvedValue({ hash: 'abc', status: 'PENDING' });
      fakeServer.pollTransaction.mockResolvedValue({ status: 'SUCCESS' });

      const checker = new DefaultChecker();
      const result = await checker.checkOverdueLoans([1, 2, 3, 4, 5]);

      expect(result).not.toBeNull();
      // 5 loans / batch_size 2 = 3 batches (2+2+1)
      expect(result!.batches).toHaveLength(3);
      // All batches should succeed — no txBAD_SEQ
      expect(result!.successfulSubmissions).toBe(3);
      expect(result!.failedSubmissions).toBe(0);
    });

    it('does not reuse the same sequence number even when batches fail on other errors', async () => {
      process.env.DEFAULT_CHECK_BATCH_SIZE = '1';
      mockSetNotExists.mockResolvedValue(true);

      const preparedTxns: unknown[] = [];
      fakeServer.prepareTransaction.mockImplementation(async (tx: unknown) => {
        preparedTxns.push(tx);
        return tx;
      });
      // Second batch fails with a non-seq error, first and third succeed
      fakeServer.sendTransaction
        .mockResolvedValueOnce({ hash: 'h1', status: 'PENDING' })
        .mockRejectedValueOnce(new Error('network error'))
        .mockResolvedValueOnce({ hash: 'h3', status: 'PENDING' });
      fakeServer.pollTransaction.mockResolvedValue({ status: 'SUCCESS' });

      const checker = new DefaultChecker();
      const result = await checker.checkOverdueLoans([1, 2, 3]);

      expect(result!.batches).toHaveLength(3);
      expect(result!.successfulSubmissions).toBe(2);
      expect(result!.failedSubmissions).toBe(1);

      // Even though batch 2 failed, all 3 transactions were built
      // with unique sequence numbers (no collision)
      const seqNums = preparedTxns.map((tx) => {
        const t = tx as { sequence?: string };
        return t.sequence ?? '';
      });
      const unique = new Set(seqNums);
      expect(unique.size).toBe(3);
    });

    it('negative: rejects batches with identical sequence numbers (old behavior)', async () => {
      // This test documents what would happen if getAccount were called per-batch
      // with no fix — all batches would get the same sequence and fail.
      // With the fix, this scenario should never occur, so we verify the fix
      // by asserting getAccount is called once.
      process.env.DEFAULT_CHECK_BATCH_SIZE = '1';
      mockSetNotExists.mockResolvedValue(true);
      fakeServer.prepareTransaction.mockImplementation(async (tx: unknown) => tx);
      fakeServer.sendTransaction.mockResolvedValue({ hash: 'abc', status: 'PENDING' });
      fakeServer.pollTransaction.mockResolvedValue({ status: 'SUCCESS' });

      const checker = new DefaultChecker();
      await checker.checkOverdueLoans([1, 2, 3]);

      // With the fix: getAccount is called exactly once (for initial fetch)
      expect(fakeServer.getAccount).toHaveBeenCalledTimes(1);
      // Without the fix it would be called 3 times (once per batch)
    });
  });
});
