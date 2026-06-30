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
});
