import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

// pauseGuard.ts talks to the database via query() (to load/persist pause
// state) and to logger — mock both so these tests exercise only the
// guard's own decision logic.
const mockQuery = jest.fn();
jest.unstable_mockModule('../../db/connection.js', () => ({
  withAdvisoryLock: async (_key: string, fn: () => Promise<unknown>) => fn(),
  query: mockQuery,
}));

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};
jest.unstable_mockModule('../../utils/logger.js', () => ({
  default: mockLogger,
}));

const {
  pauseGuard,
  setPauseState,
  getCurrentPauseState,
  updatePauseStateFromDatabase,
  getPauseState,
  initializePauseState,
  startPauseStateRefresh,
  stopPauseStateRefresh,
} = await import('../pauseGuard.js');
const { AppError } = await import('../../errors/AppError.js');

describe('pauseGuard middleware (#1521 & #2093 state races)', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [] });

    // Reset the module's in-memory pause state to "not paused" between
    // tests via the same code path production uses (setPauseState).
    await setPauseState(false, []);
    jest.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [] });

    mockRequest = { method: 'POST', path: '/api/loans/repay' };
    mockResponse = {};
    mockNext = jest.fn();
  });

  afterEach(() => {
    stopPauseStateRefresh();
  });

  describe('when paused', () => {
    beforeEach(async () => {
      await setPauseState(true, ['CONTRACT_A', 'CONTRACT_B'], 'Security incident');
      jest.clearAllMocks();
    });

    it('blocks a POST (write) request with a 503 AppError', () => {
      expect(() => pauseGuard(mockRequest as Request, mockResponse as Response, mockNext)).toThrow(
        AppError,
      );

      try {
        pauseGuard(mockRequest as Request, mockResponse as Response, mockNext);
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as InstanceType<typeof AppError>).statusCode).toBe(503);
        expect((err as InstanceType<typeof AppError>).message).toContain('Security incident');
        expect((err as InstanceType<typeof AppError>).message).toContain('CONTRACT_A');
      }

      expect(mockNext).not.toHaveBeenCalled();
    });

    it('blocks PUT, PATCH, and DELETE the same as POST', () => {
      for (const method of ['PUT', 'PATCH', 'DELETE']) {
        const req = { ...mockRequest, method } as Request;
        expect(() => pauseGuard(req, mockResponse as Response, mockNext)).toThrow(AppError);
      }
    });

    it('still allows GET requests through', () => {
      const req = { ...mockRequest, method: 'GET' } as Request;
      pauseGuard(req, mockResponse as Response, mockNext);
      expect(mockNext).toHaveBeenCalledWith();
    });

    it('still allows HEAD and OPTIONS requests through (read-only bypass)', () => {
      for (const method of ['HEAD', 'OPTIONS']) {
        const req = { ...mockRequest, method } as Request;
        const next = jest.fn();
        pauseGuard(req, mockResponse as Response, next);
        expect(next).toHaveBeenCalledWith();
      }
    });

    it('allows exempt authentication endpoints during pause', () => {
      const exemptPaths = ['/api/auth/login', '/api/auth/challenge', '/api/v1/auth/verify'];
      for (const path of exemptPaths) {
        const next = jest.fn();
        const req = { method: 'POST', path } as Request;
        pauseGuard(req, mockResponse as Response, next);
        expect(next).toHaveBeenCalledWith();
      }
    });

    it('allows exempt admin endpoints during pause for incident resolution', () => {
      const exemptPaths = ['/api/admin/unpause', '/api/v1/admin/pause-state', '/admin/dashboard'];
      for (const path of exemptPaths) {
        const next = jest.fn();
        const req = { method: 'POST', path } as Request;
        pauseGuard(req, mockResponse as Response, next);
        expect(next).toHaveBeenCalledWith();
      }
    });

    it('logs a warning identifying the blocked request and pause reason', () => {
      try {
        pauseGuard(mockRequest as Request, mockResponse as Response, mockNext);
      } catch {
        // expected — asserted separately above
      }

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Request rejected due to contract pause',
        expect.objectContaining({
          method: 'POST',
          path: '/api/loans/repay',
          contracts: ['CONTRACT_A', 'CONTRACT_B'],
          reason: 'Security incident',
        }),
      );
    });
  });

  describe('when not paused', () => {
    it('allows a POST (write) request through', () => {
      pauseGuard(mockRequest as Request, mockResponse as Response, mockNext);
      expect(mockNext).toHaveBeenCalledWith();
    });

    it('allows GET requests through', () => {
      const req = { ...mockRequest, method: 'GET' } as Request;
      pauseGuard(req, mockResponse as Response, mockNext);
      expect(mockNext).toHaveBeenCalledWith();
    });

    it('does not log a warning', () => {
      pauseGuard(mockRequest as Request, mockResponse as Response, mockNext);
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });
  });

  describe('concurrent pause state changes and races (#2093)', () => {
    it('handles concurrent setPauseState calls and converges to the latest committed state', async () => {
      let resolveFirst!: () => void;
      const firstQueryStarted = new Promise<void>((r) => {
        resolveFirst = r;
      });

      // Call 1 completes first, Call 2 completes second
      mockQuery
        .mockImplementationOnce(async () => {
          resolveFirst();
          return { rows: [] };
        })
        .mockImplementationOnce(async () => {
          await new Promise((r) => setTimeout(r, 20));
          return { rows: [] };
        });

      // Call 1: Pause contracts
      const call1 = setPauseState(true, ['CONTRACT_A'], 'initial pause');
      await firstQueryStarted;

      // Call 2: Unpause contracts running concurrently and finishing after call 1
      const call2 = setPauseState(false, []);

      await Promise.all([call1, call2]);

      // The second call committed last; state reflects the latest committed operation
      const state = getCurrentPauseState();
      expect(state.isPaused).toBe(false);
      expect(state.contracts).toEqual([]);
    });

    it('propagates DB write errors on concurrent setPauseState without corrupting subsequent calls', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Deadlock detected'));

      // Failed pause attempt
      await expect(setPauseState(true, ['CONTRACT_FAIL'], 'failed pause')).rejects.toThrow(
        'Deadlock detected',
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to set pause state',
        expect.objectContaining({ isPaused: true }),
      );

      // State was not changed to paused
      expect(getCurrentPauseState().isPaused).toBe(false);

      // Subsequent successful call operates normally
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await expect(setPauseState(true, ['CONTRACT_OK'], 'recovered')).resolves.not.toThrow();
      expect(getCurrentPauseState().isPaused).toBe(true);
      expect(getCurrentPauseState().reason).toBe('recovered');
    });

    it('synchronizes stale loan state when another replica updates pause state in database', async () => {
      // Initially, local replica in-memory state is NOT paused
      expect(getCurrentPauseState().isPaused).toBe(false);
      const loanReq = { method: 'POST', path: '/api/loans/borrow' } as Request;
      const next1 = jest.fn();
      pauseGuard(loanReq, mockResponse as Response, next1);
      expect(next1).toHaveBeenCalled();

      // Another replica writes pause state to the database
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            is_paused: true,
            paused_at: new Date(),
            reason: 'Critical vulnerability in lending pool',
            contracts: ['LENDING_POOL'],
          },
        ],
      });

      // Background refresh / state synchronization runs
      await updatePauseStateFromDatabase();

      // Guard immediately reflects synchronized DB state, rejecting subsequent writes
      const next2 = jest.fn();
      expect(() => pauseGuard(loanReq, mockResponse as Response, next2)).toThrow(AppError);
      expect(next2).not.toHaveBeenCalled();

      const state = getCurrentPauseState();
      expect(state.isPaused).toBe(true);
      expect(state.reason).toBe('Critical vulnerability in lending pool');
      expect(state.contracts).toEqual(['LENDING_POOL']);
    });

    it('unblocks requests immediately when stale paused state is refreshed to unpaused in DB', async () => {
      // Start in paused state
      await setPauseState(true, ['LENDING_POOL'], 'pause');
      const loanReq = { method: 'POST', path: '/api/loans/repay' } as Request;
      expect(() => pauseGuard(loanReq, mockResponse as Response, jest.fn())).toThrow(AppError);

      // DB is updated by another process to unpaused
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            is_paused: false,
            paused_at: null,
            reason: null,
            contracts: [],
          },
        ],
      });

      // Synchronize
      await updatePauseStateFromDatabase();

      // Subsequent loan write request is now allowed
      const next = jest.fn();
      pauseGuard(loanReq, mockResponse as Response, next);
      expect(next).toHaveBeenCalledWith();
    });

    it('preserves existing in-memory state when DB query returns empty rows (stale state resilience)', async () => {
      await setPauseState(true, ['POOL_A'], 'preserve test');

      mockQuery.mockResolvedValueOnce({ rows: [] });
      await updatePauseStateFromDatabase();

      const state = getCurrentPauseState();
      expect(state.isPaused).toBe(true);
      expect(state.reason).toBe('preserve test');
      expect(state.contracts).toEqual(['POOL_A']);
    });

    it('safely handles DB row with null contracts and null reason without throwing', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            is_paused: true,
            paused_at: null,
            reason: null,
            contracts: null,
          },
        ],
      });

      await updatePauseStateFromDatabase();

      const state = getCurrentPauseState();
      expect(state.isPaused).toBe(true);
      expect(state.contracts).toEqual([]);
      expect(state.reason).toBeNull();

      // pauseGuard should use fallback message without throwing TypeError on contracts.join
      expect(() => pauseGuard(mockRequest as Request, mockResponse as Response, mockNext)).toThrow(
        AppError,
      );

      try {
        pauseGuard(mockRequest as Request, mockResponse as Response, mockNext);
      } catch (err) {
        expect((err as InstanceType<typeof AppError>).message).toContain(
          'Maintenance or security measure',
        );
      }
    });

    it('processes interleaved read and write requests correctly across state transitions', async () => {
      const getReq = { method: 'GET', path: '/api/loans' } as Request;
      const postReq = { method: 'POST', path: '/api/loans/create' } as Request;
      const adminReq = { method: 'POST', path: '/api/admin/loans/review' } as Request;

      // 1. Unpaused: all allowed
      const next1 = jest.fn();
      const next2 = jest.fn();
      const next3 = jest.fn();
      pauseGuard(getReq, mockResponse as Response, next1);
      pauseGuard(postReq, mockResponse as Response, next2);
      pauseGuard(adminReq, mockResponse as Response, next3);
      expect(next1).toHaveBeenCalled();
      expect(next2).toHaveBeenCalled();
      expect(next3).toHaveBeenCalled();

      // 2. Transition to Paused
      await setPauseState(true, ['CONTRACT_LOANS'], 'maintenance');

      const nextGet = jest.fn();
      const nextAdmin = jest.fn();
      pauseGuard(getReq, mockResponse as Response, nextGet);
      pauseGuard(adminReq, mockResponse as Response, nextAdmin);
      expect(nextGet).toHaveBeenCalled();
      expect(nextAdmin).toHaveBeenCalled();

      // Mutating non-exempt request is blocked
      expect(() => pauseGuard(postReq, mockResponse as Response, jest.fn())).toThrow(AppError);

      // 3. Transition back to Unpaused
      await setPauseState(false, []);
      const nextPostAfter = jest.fn();
      pauseGuard(postReq, mockResponse as Response, nextPostAfter);
      expect(nextPostAfter).toHaveBeenCalled();
    });
  });

  describe('initialization and lifecycle management', () => {
    it('creates table, seeds default row, and updates state during initializePauseState', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // CREATE TABLE
        .mockResolvedValueOnce({ rows: [] }) // INSERT INTO pause_state
        .mockResolvedValueOnce({
          rows: [
            {
              is_paused: false,
              paused_at: null,
              reason: null,
              contracts: [],
            },
          ],
        }); // SELECT

      await expect(initializePauseState()).resolves.not.toThrow();

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS pause_state'),
      );
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO pause_state'));
      expect(mockLogger.info).toHaveBeenCalledWith('Pause guard initialized');
    });

    it('logs error and throws if initializePauseState query fails', async () => {
      const initError = new Error('Database unreachable');
      mockQuery.mockRejectedValueOnce(initError);

      await expect(initializePauseState()).rejects.toThrow('Database unreachable');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to initialize pause state',
        expect.objectContaining({ error: initError }),
      );
    });

    it('safely handles startPauseStateRefresh and stopPauseStateRefresh idempotently', () => {
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      try {
        startPauseStateRefresh();
        // Second call should be a no-op (idempotent)
        startPauseStateRefresh();

        // Stopping should clear timer cleanly
        stopPauseStateRefresh();
        stopPauseStateRefresh();
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
      }
    });
  });

  describe('setPauseState', () => {
    it('updates the in-memory pause state read by pauseGuard', async () => {
      await setPauseState(true, ['CONTRACT_X'], 'Upgrade in progress');

      expect(getCurrentPauseState()).toEqual(
        expect.objectContaining({
          isPaused: true,
          contracts: ['CONTRACT_X'],
          reason: 'Upgrade in progress',
        }),
      );

      expect(() => pauseGuard(mockRequest as Request, mockResponse as Response, mockNext)).toThrow(
        AppError,
      );
    });

    it('persists the new state via query()', async () => {
      await setPauseState(true, ['CONTRACT_X'], 'Upgrade in progress');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO pause_state'),
        expect.arrayContaining([true, expect.any(Date), 'Upgrade in progress']),
      );
    });
  });

  describe('updatePauseStateFromDatabase', () => {
    it('refreshes in-memory state from a mocked query result', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          {
            is_paused: true,
            paused_at: new Date('2025-01-01T00:00:00Z'),
            reason: 'DB maintenance',
            contracts: ['CONTRACT_DB'],
          },
        ],
      });

      await updatePauseStateFromDatabase();

      const state = getCurrentPauseState();
      expect(state.isPaused).toBe(true);
      expect(state.reason).toBe('DB maintenance');
      expect(state.contracts).toEqual(['CONTRACT_DB']);
    });

    it('fails open (does not throw) when the DB query errors', async () => {
      mockQuery.mockRejectedValue(new Error('connection refused'));

      await expect(updatePauseStateFromDatabase()).resolves.not.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to update pause state from database',
        expect.objectContaining({ error: expect.any(Error) }),
      );
    });
  });

  describe('getPauseState', () => {
    it('returns the current pause state with expected shape', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          {
            is_paused: false,
            paused_at: null,
            reason: null,
            contracts: [],
          },
        ],
      });

      const mockJson = jest.fn();
      const req = {} as Request;
      const res = { json: mockJson } as unknown as Response;
      const next = jest.fn() as NextFunction;

      await getPauseState(req, res, next);

      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            isPaused: expect.any(Boolean),
            contracts: expect.any(Array),
            timestamp: expect.any(Date),
          }),
        }),
      );
    });
  });
});
