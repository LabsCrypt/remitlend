import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

const mockStart = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockStop = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockConstructor = jest.fn<(config: Record<string, unknown>) => void>();

jest.unstable_mockModule('../eventIndexer.js', () => ({
  EventIndexer: class {
    constructor(config: Record<string, unknown>) {
      mockConstructor(config);
    }

    start(): Promise<void> {
      return mockStart();
    }

    stop(): Promise<void> {
      return mockStop();
    }
  },
}));

const mockLogger = {
  withContext: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};
mockLogger.withContext.mockReturnValue(mockLogger);

jest.unstable_mockModule('../../utils/logger.js', () => ({
  default: mockLogger,
}));

jest.unstable_mockModule('../../config/stellar.js', () => ({
  getStellarRpcUrl: () => 'https://soroban-testnet.stellar.org',
}));

const { startIndexer, stopIndexer, getIndexer } = await import('../indexerManager.js');

const CONTRACT_ENV_VARS = [
  'LOAN_MANAGER_CONTRACT_ID',
  'LENDING_POOL_CONTRACT_ID',
  'REMITTANCE_NFT_CONTRACT_ID',
  'MULTISIG_GOVERNANCE_CONTRACT_ID',
  'INDEXER_POLL_INTERVAL_MS',
  'INDEXER_BATCH_SIZE',
] as const;

const clearContractEnv = (): void => {
  for (const name of CONTRACT_ENV_VARS) {
    delete process.env[name];
  }
};

const flushAsync = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('indexerManager', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockStart.mockResolvedValue(undefined);
    mockStop.mockResolvedValue(undefined);
    mockLogger.withContext.mockReturnValue(mockLogger);
    clearContractEnv();
    // Reset the module-level singleton between tests, whatever happened before.
    await stopIndexer();
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await stopIndexer();
    clearContractEnv();
  });

  it('does not schedule a worker when no contract IDs are configured', () => {
    startIndexer();

    expect(mockConstructor).not.toHaveBeenCalled();
    expect(mockStart).not.toHaveBeenCalled();
    expect(getIndexer()).toBeNull();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('No contract IDs set for indexer'),
    );
  });

  it('starts a single worker with the configured contracts and poll settings', () => {
    process.env.LOAN_MANAGER_CONTRACT_ID = 'CLOANMANAGER';
    process.env.LENDING_POOL_CONTRACT_ID = 'CLENDINGPOOL';
    process.env.INDEXER_POLL_INTERVAL_MS = '15000';
    process.env.INDEXER_BATCH_SIZE = '250';

    startIndexer();

    expect(mockConstructor).toHaveBeenCalledTimes(1);
    expect(mockConstructor).toHaveBeenCalledWith({
      rpcUrl: 'https://soroban-testnet.stellar.org',
      contractConfigs: [{ contractId: 'CLOANMANAGER' }, { contractId: 'CLENDINGPOOL' }],
      pollIntervalMs: 15000,
      batchSize: 250,
    });
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(getIndexer()).not.toBeNull();
  });

  it('falls back to default poll interval and batch size for non-numeric env values', () => {
    process.env.LOAN_MANAGER_CONTRACT_ID = 'CLOANMANAGER';
    process.env.INDEXER_POLL_INTERVAL_MS = 'not-a-number';
    process.env.INDEXER_BATCH_SIZE = '';

    startIndexer();

    expect(mockConstructor).toHaveBeenCalledWith(
      expect.objectContaining({ pollIntervalMs: 30000, batchSize: 100 }),
    );
  });

  it('ignores duplicate scheduling while a worker is already running', () => {
    process.env.LOAN_MANAGER_CONTRACT_ID = 'CLOANMANAGER';

    startIndexer();
    const firstInstance = getIndexer();
    startIndexer();

    expect(mockConstructor).toHaveBeenCalledTimes(1);
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(getIndexer()).toBe(firstInstance);
    expect(mockLogger.warn).toHaveBeenCalledWith('Indexer already running');
  });

  it('stops the worker and clears the singleton so it can be restarted', async () => {
    process.env.LOAN_MANAGER_CONTRACT_ID = 'CLOANMANAGER';

    startIndexer();
    expect(getIndexer()).not.toBeNull();

    await stopIndexer();
    expect(mockStop).toHaveBeenCalledTimes(1);
    expect(getIndexer()).toBeNull();

    startIndexer();
    expect(mockConstructor).toHaveBeenCalledTimes(2);
    expect(mockStart).toHaveBeenCalledTimes(2);
    expect(getIndexer()).not.toBeNull();
  });

  it('is a no-op when stopping an indexer that was never started', async () => {
    await expect(stopIndexer()).resolves.toBeUndefined();
    expect(mockStop).not.toHaveBeenCalled();
  });

  it('recovers from a failed start so a later restart succeeds', async () => {
    process.env.LOAN_MANAGER_CONTRACT_ID = 'CLOANMANAGER';
    mockStart.mockRejectedValueOnce(new Error('RPC unavailable'));

    startIndexer();
    await flushAsync();

    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(getIndexer()).toBeNull();
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Failed to start indexer',
      expect.objectContaining({ error: expect.any(Error) }),
    );

    // The failed worker must not block a retry (stalled job recovery).
    mockStart.mockResolvedValue(undefined);
    startIndexer();

    expect(mockConstructor).toHaveBeenCalledTimes(2);
    expect(mockStart).toHaveBeenCalledTimes(2);
    expect(getIndexer()).not.toBeNull();
  });

  it('skips contract IDs that are blank or whitespace-only', () => {
    process.env.LOAN_MANAGER_CONTRACT_ID = '   ';
    process.env.LENDING_POOL_CONTRACT_ID = '';

    startIndexer();

    expect(mockConstructor).not.toHaveBeenCalled();
    expect(getIndexer()).toBeNull();
  });

  it('does not leak a stopped worker into a failed restart', async () => {
    process.env.LOAN_MANAGER_CONTRACT_ID = 'CLOANMANAGER';

    startIndexer();
    await stopIndexer();
    expect(getIndexer()).toBeNull();

    mockStart.mockRejectedValueOnce(new Error('timeout'));
    startIndexer();
    await flushAsync();

    expect(getIndexer()).toBeNull();
    expect(mockConstructor).toHaveBeenCalledTimes(2);
  });
});
