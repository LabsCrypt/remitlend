import { jest } from '@jest/globals';

const mockQuery = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockRelease = jest.fn<(err?: Error | boolean) => void>();

const mockClient = {
  query: mockQuery,
  release: mockRelease,
};

const mockConnect = jest.fn<() => Promise<typeof mockClient>>();
const mockPoolQuery = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockPoolEnd = jest.fn<() => Promise<void>>();
const mockPoolOn = jest.fn<(event: string, listener: (...args: unknown[]) => void) => void>();

const mockPoolInstance = {
  connect: mockConnect,
  query: mockPoolQuery,
  end: mockPoolEnd,
  on: mockPoolOn,
  totalCount: 1,
  idleCount: 1,
  waitingCount: 0,
};

jest.unstable_mockModule('pg', () => ({
  default: {
    Pool: jest.fn(() => mockPoolInstance),
  },
}));

const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

jest.unstable_mockModule('../../utils/logger.js', () => ({
  default: mockLogger,
}));

// Import after mocking
const { withTransaction: withTxConnection } = await import('../connection.js');
const {
  withTransaction: withTxTransaction,
  executeTransactionQueries,
  withStellarAndDbTransaction,
} = await import('../transaction.js');

describe('Database Transaction Management', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConnect.mockResolvedValue(mockClient);
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  describe('Unification Invariant', () => {
    it('db/transaction.ts exports the exact same withTransaction function as db/connection.ts', () => {
      expect(withTxTransaction).toBe(withTxConnection);
    });
  });

  describe('withTransaction happy path and commit-on-success', () => {
    it('acquires client, executes BEGIN, runs operations callback, and executes COMMIT', async () => {
      const operationCallback = jest.fn(async (client: typeof mockClient) => {
        await client.query('INSERT INTO test VALUES ($1)', [1]);
        return 'success_result';
      });

      const result = await withTxTransaction(operationCallback as any);

      expect(mockConnect).toHaveBeenCalledTimes(1);
      expect(mockQuery).toHaveBeenNthCalledWith(1, 'BEGIN');
      expect(operationCallback).toHaveBeenCalledTimes(1);
      expect(mockQuery).toHaveBeenNthCalledWith(2, 'INSERT INTO test VALUES ($1)', [1]);
      expect(mockQuery).toHaveBeenNthCalledWith(3, 'COMMIT');
      expect(result).toBe('success_result');
      expect(mockRelease).toHaveBeenCalledTimes(1);
      expect(mockRelease).toHaveBeenCalledWith(); // Clean release without error
    });
  });

  describe('withTransaction failure path and rollback+rethrow', () => {
    it('executes ROLLBACK, releases client, and rethrows original error when operation fails', async () => {
      const operationError = new Error('Constraint violation');
      const operationCallback = jest.fn(async () => {
        throw operationError;
      });

      await expect(withTxTransaction(operationCallback as any, 0)).rejects.toThrow(operationError);

      expect(mockQuery).toHaveBeenCalledWith('BEGIN');
      expect(mockQuery).toHaveBeenCalledWith('ROLLBACK');
      expect(mockRelease).toHaveBeenCalledTimes(1);
      expect(mockRelease).toHaveBeenCalledWith(); // Clean release when rollback succeeds
    });

    it('safely catches rollback failures, logs error, rethrows original error, and releases client with error', async () => {
      const operationError = new Error('Primary query failed');
      const rollbackError = new Error('Connection reset during rollback');

      mockQuery.mockImplementation(async (sql: unknown) => {
        if (sql === 'BEGIN') return {};
        if (sql === 'ROLLBACK') throw rollbackError;
        throw operationError;
      });

      const operationCallback = jest.fn(async (client: typeof mockClient) => {
        await client.query('UPDATE balance SET amount = 0');
      });

      // Assert original error is re-thrown (not replaced or swallowed by rollback failure)
      await expect(withTxTransaction(operationCallback as any, 0)).rejects.toThrow(operationError);

      // Rollback was attempted
      expect(mockQuery).toHaveBeenCalledWith('ROLLBACK');

      // Rollback failure was safely logged
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to rollback transaction', {
        rollbackError,
      });

      // Invariant: Broken client must be released WITH error so pg discards rather than recycles it
      expect(mockRelease).toHaveBeenCalledTimes(1);
      expect(mockRelease).toHaveBeenCalledWith(rollbackError);
    });
  });

  describe('withTransaction retry on transient errors', () => {
    it('retries on serialization_failure (40001) and succeeds on subsequent attempt', async () => {
      const transientError = Object.assign(
        new Error('could not serialize access due to concurrent update'),
        {
          code: '40001',
        },
      );

      let attempts = 0;
      const operationCallback = jest.fn(async () => {
        attempts++;
        if (attempts === 1) {
          throw transientError;
        }
        return 'retry_recovered';
      });

      const result = await withTxTransaction(operationCallback as any, 3, 10);

      expect(result).toBe('retry_recovered');
      expect(attempts).toBe(2);
      expect(mockConnect).toHaveBeenCalledTimes(2);
      expect(mockRelease).toHaveBeenCalledTimes(2);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'Transient DB error in transaction (40001). Retrying in 10ms (attempt 1/3)',
        ),
      );
    });

    it('retries on deadlock_detected (40P01) and exhausts maxRetries if transient error persists', async () => {
      const deadlockError = Object.assign(new Error('deadlock detected'), {
        code: '40P01',
      });

      const operationCallback = jest.fn(async () => {
        throw deadlockError;
      });

      await expect(withTxTransaction(operationCallback as any, 2, 5)).rejects.toThrow(
        deadlockError,
      );

      // Initial attempt (0) + 2 retries (1, 2) = 3 total attempts
      expect(operationCallback).toHaveBeenCalledTimes(3);
      expect(mockConnect).toHaveBeenCalledTimes(3);
      expect(mockRelease).toHaveBeenCalledTimes(3);
      expect(mockLogger.warn).toHaveBeenCalledTimes(2);
    });
  });

  describe('executeTransactionQueries', () => {
    it('executes a batch of queries sequentially within transaction', async () => {
      const queries = [
        { text: 'INSERT INTO users (id) VALUES ($1)', params: ['user-1'] },
        { text: 'UPDATE balance SET total = $1 WHERE user_id = $2', params: [100, 'user-1'] },
      ];

      mockQuery.mockImplementation(async (sql: unknown) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') return {};
        return { rows: [{ affected: 1 }], rowCount: 1 };
      });

      const results = await executeTransactionQueries(queries);

      expect(results).toHaveLength(2);
      expect(mockQuery).toHaveBeenCalledWith('BEGIN');
      expect(mockQuery).toHaveBeenCalledWith('INSERT INTO users (id) VALUES ($1)', ['user-1']);
      expect(mockQuery).toHaveBeenCalledWith('UPDATE balance SET total = $1 WHERE user_id = $2', [
        100,
        'user-1',
      ]);
      expect(mockQuery).toHaveBeenCalledWith('COMMIT');
      expect(mockRelease).toHaveBeenCalledTimes(1);
    });
  });

  describe('withStellarAndDbTransaction', () => {
    it('executes stellarOperation first and passes result to dbOperations inside transaction', async () => {
      const mockStellarResult = { txHash: '0x123abc', ledger: 500 };
      const stellarOp = jest.fn(async () => mockStellarResult);
      const dbOp = jest.fn(async (stellarRes: unknown, client: typeof mockClient) => {
        await client.query('INSERT INTO audit VALUES ($1)', [(stellarRes as any).txHash]);
        return { saved: true };
      });

      const result = await withStellarAndDbTransaction(stellarOp, dbOp as any);

      expect(stellarOp).toHaveBeenCalledTimes(1);
      expect(dbOp).toHaveBeenCalledWith(mockStellarResult, mockClient);
      expect(result).toEqual({
        stellarResult: mockStellarResult,
        dbResult: { saved: true },
      });
      expect(mockQuery).toHaveBeenCalledWith('BEGIN');
      expect(mockQuery).toHaveBeenCalledWith('COMMIT');
    });

    it('aborts and does not execute DB transaction if stellarOperation rejects', async () => {
      const stellarError = new Error('Soroban RPC submission failed');
      const stellarOp = jest.fn(async () => {
        throw stellarError;
      });
      const dbOp = jest.fn();

      await expect(withStellarAndDbTransaction(stellarOp, dbOp)).rejects.toThrow(stellarError);

      expect(stellarOp).toHaveBeenCalledTimes(1);
      expect(dbOp).not.toHaveBeenCalled();
      expect(mockConnect).not.toHaveBeenCalled();
    });

    it('logs warning for reconciliation and rethrows if dbOperations fail after stellarOperation succeeds', async () => {
      const mockStellarResult = { txHash: '0xconfirmed-on-chain' };
      const dbError = new Error('Database disk full');

      const stellarOp = jest.fn(async () => mockStellarResult);
      const dbOp = jest.fn(async () => {
        throw dbError;
      });

      await expect(withStellarAndDbTransaction(stellarOp, dbOp)).rejects.toThrow(dbError);

      expect(stellarOp).toHaveBeenCalledTimes(1);
      expect(dbOp).toHaveBeenCalledTimes(1);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Stellar transaction might need manual reconciliation',
        expect.any(Object),
      );
    });
  });
});
