/**
 * Additional tests for scoresService - clamping and setAbsoluteUserScoresBulk
 */

import { jest, describe, it, expect, beforeAll, beforeEach } from '@jest/globals';
import type { PoolClient } from '../../db/connection.js';

type QueryFn = (sql: string, params?: unknown[]) => Promise<{ rows: never[]; rowCount: number }>;
type DeleteFn = (key: string) => Promise<void>;

let updateUserScoresBulk: (updates: Map<string, number>, client?: PoolClient) => Promise<void>;
let setAbsoluteUserScoresBulk: (scores: Map<string, number>) => Promise<void>;
let mockQuery: jest.MockedFunction<QueryFn>;
let mockLoggerError: jest.Mock;
let mockCacheDelete: jest.MockedFunction<DeleteFn>;

beforeAll(async () => {
  mockQuery = jest.fn(async () => ({
    rows: [],
    rowCount: 1,
  })) as jest.MockedFunction<QueryFn>;
  mockLoggerError = jest.fn();
  mockCacheDelete = jest.fn(async () => undefined) as jest.MockedFunction<DeleteFn>;

  jest.unstable_mockModule('../../db/connection.js', () => ({
    query: mockQuery,
    getClient: jest.fn(),
    withTransaction: jest.fn(),
    TRANSIENT_ERROR_CODES: new Set(),
  }));

  jest.unstable_mockModule('../../utils/logger.js', () => {
    const mockLogger = {
      info: jest.fn(),
      error: mockLoggerError,
      warn: jest.fn(),
      debug: jest.fn(),
      withContext: jest.fn(),
    };
    mockLogger.withContext.mockImplementation(() => mockLogger);
    return { default: mockLogger };
  });

  jest.unstable_mockModule('../cacheService.js', () => ({
    cacheService: {
      delete: mockCacheDelete,
      get: jest.fn(async () => null),
      set: jest.fn(async () => undefined),
      setNotExists: jest.fn(async () => true),
      close: jest.fn(async () => undefined),
    },
  }));

  const mod = await import('../scoresService.js');
  updateUserScoresBulk = mod.updateUserScoresBulk;
  setAbsoluteUserScoresBulk = mod.setAbsoluteUserScoresBulk;
});

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
});

describe('updateUserScoresBulk clamping', () => {
  it('clamps insert score to 300 minimum', async () => {
    await updateUserScoresBulk(new Map([['user_low', -250]]));

    const [sql] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('GREATEST(300,');
  });

  it('clamps insert score to 850 maximum', async () => {
    await updateUserScoresBulk(new Map([['user_high', 400]]));

    const [sql] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('LEAST(850,');
  });

  it('clamps update score within 300-850 range', async () => {
    await updateUserScoresBulk(new Map([['user_existing', 100]]));

    const [sql] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('LEAST(850, GREATEST(300,');
  });

  it('applies positive deltas as score increases in bulk upserts', async () => {
    await updateUserScoresBulk(new Map([['user_reward', 25]]));

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual(['user_reward', 25]);
    expect(sql).toContain('500 + $2');
    expect(sql).toContain('scores.current_score + EXCLUDED.current_score - 500');
    expect(sql).not.toContain('500 - $2');
  });});

describe('setAbsoluteUserScoresBulk', () => {
  it('is a noop for empty map', async () => {
    await setAbsoluteUserScoresBulk(new Map());
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('is a noop for map with only empty user IDs', async () => {
    await setAbsoluteUserScoresBulk(new Map([['', 700]]));
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('generates correct value placeholders for single user', async () => {
    await setAbsoluteUserScoresBulk(new Map([['user1', 650]]));

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];

    expect(sql).toContain('WITH reconciled_scores');
    expect(sql).toContain('VALUES ($1, $2)');
    expect(params).toEqual(['user1', 650]);
  });

  it('generates correct value placeholders for multiple users', async () => {
    await setAbsoluteUserScoresBulk(
      new Map([
        ['alice', 750],
        ['bob', 550],
      ]),
    );

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];

    expect(sql).toContain('WITH reconciled_scores');
    expect(params).toContain('alice');
    expect(params).toContain(750);
    expect(params).toContain('bob');
    expect(params).toContain(550);
  });

  it('invalidates cache for reconciled users', async () => {
    await setAbsoluteUserScoresBulk(new Map([['user1', 600]]));

    expect(mockCacheDelete).toHaveBeenCalledWith('score:userId:user1');
    expect(mockCacheDelete).toHaveBeenCalledWith('score:breakdown:user1');
  });

  it('propagates errors and logs them', async () => {
    mockQuery.mockRejectedValueOnce(new Error('reconciliation db error'));

    await expect(setAbsoluteUserScoresBulk(new Map([['user1', 600]]))).rejects.toThrow(
      'reconciliation db error',
    );

    expect(mockLoggerError).toHaveBeenCalledWith(
      'Failed to apply absolute user score reconciliation updates',
      expect.objectContaining({ error: expect.any(Error) }),
    );
  });

  it('sets absolute values without clamping', async () => {
    await setAbsoluteUserScoresBulk(new Map([['user1', 999]]));

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];

    expect(sql).not.toContain('LEAST');
    expect(sql).not.toContain('GREATEST');
    expect(params).toContain(999);
  });
});
