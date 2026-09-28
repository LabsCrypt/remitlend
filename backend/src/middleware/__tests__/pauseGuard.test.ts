import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

// pauseGuard.ts talks to the database via query() (to load/persist pause
// state) and to logger — mock both so these tests exercise only the
// guard's own decision logic.
const mockQuery = jest.fn();
jest.unstable_mockModule('../../db/connection.js', () => ({
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
} = await import('../pauseGuard.js');
const { AppError } = await import('../../errors/AppError.js');

describe('pauseGuard middleware (#1521)', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [] });

    // Reset the module's in-memory pause state to "not paused" between
    // tests via the same code path production uses (setPauseState), since
    // globalPauseState is private module state with no direct reset hook.
    await setPauseState(false, []);
    jest.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [] });

    mockRequest = { method: 'POST', path: '/api/loans/repay' };
    mockResponse = {};
    mockNext = jest.fn();
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

    it('allows mutating requests to /api/auth/ when paused so users and operators can authenticate', () => {
      const req = { ...mockRequest, path: '/api/auth/login', method: 'POST' } as Request;
      pauseGuard(req, mockResponse as Response, mockNext);
      expect(mockNext).toHaveBeenCalledWith();
    });

    it('allows mutating requests to /admin/ when paused so operators can manage and unpause', () => {
      const req = { ...mockRequest, path: '/admin/contracts/unpause', method: 'POST' } as Request;
      pauseGuard(req, mockResponse as Response, mockNext);
      expect(mockNext).toHaveBeenCalledWith();
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
    it('refreshes pause state from a mocked database query result', async () => {
      const pausedAt = new Date('2026-09-28T12:00:00.000Z');
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            is_paused: true,
            paused_at: pausedAt,
            reason: 'Critical bug detected in contract',
            contracts: ['CONTRACT_ALPHA', 'CONTRACT_BETA'],
          },
        ],
      });

      await updatePauseStateFromDatabase();

      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT is_paused, paused_at, reason, contracts FROM pause_state LIMIT 1',
      );
      expect(getCurrentPauseState()).toEqual({
        isPaused: true,
        pausedAt,
        reason: 'Critical bug detected in contract',
        contracts: ['CONTRACT_ALPHA', 'CONTRACT_BETA'],
      });
    });

    it('handles query returning empty rows without modifying existing state', async () => {
      await setPauseState(true, ['CONTRACT_A'], 'Active incident');
      jest.clearAllMocks();

      mockQuery.mockResolvedValueOnce({ rows: [] });

      await updatePauseStateFromDatabase();

      expect(mockQuery).toHaveBeenCalled();
      expect(getCurrentPauseState()).toEqual(
        expect.objectContaining({
          isPaused: true,
          contracts: ['CONTRACT_A'],
          reason: 'Active incident',
        }),
      );
    });

    it('defaults contracts to empty array when row contracts column is null', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            is_paused: false,
            paused_at: null,
            reason: null,
            contracts: null,
          },
        ],
      });

      await updatePauseStateFromDatabase();

      expect(getCurrentPauseState().contracts).toEqual([]);
    });

    it('fails open when the database query throws without blocking requests or crashing', async () => {
      await setPauseState(false, []);
      jest.clearAllMocks();

      const dbError = new Error('PostgreSQL connection timeout');
      mockQuery.mockRejectedValueOnce(dbError);

      await expect(updatePauseStateFromDatabase()).resolves.toBeUndefined();

      expect(mockLogger.error).toHaveBeenCalledWith('Failed to update pause state from database', {
        error: dbError,
      });

      // Verify fail-open: existing in-memory state is preserved and unpaused
      expect(getCurrentPauseState().isPaused).toBe(false);
      pauseGuard(mockRequest as Request, mockResponse as Response, mockNext);
      expect(mockNext).toHaveBeenCalledWith();
    });
  });

  describe('getPauseState (GET /api/status/pause handler)', () => {
    it('refreshes from database and returns standard response shape', async () => {
      const pausedAt = new Date('2026-09-28T14:30:00.000Z');
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            is_paused: true,
            paused_at: pausedAt,
            reason: 'Routine security audit',
            contracts: ['CONTRACT_AUDIT'],
          },
        ],
      });

      const jsonMock = jest.fn();
      const res = { json: jsonMock } as unknown as Response;
      const next = jest.fn();

      await getPauseState(mockRequest as Request, res, next);

      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT is_paused, paused_at, reason, contracts FROM pause_state LIMIT 1',
      );
      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        data: {
          isPaused: true,
          pausedAt,
          reason: 'Routine security audit',
          contracts: ['CONTRACT_AUDIT'],
          timestamp: expect.any(Date),
        },
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('forwards unexpected error to next() when response handling fails', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const responseError = new Error('Stream write failed');
      const res = {
        json: jest.fn().mockImplementation(() => {
          throw responseError;
        }),
      } as unknown as Response;
      const next = jest.fn();

      await getPauseState(mockRequest as Request, res, next);

      expect(next).toHaveBeenCalledWith(responseError);
    });
  });

  describe('initializePauseState (server startup)', () => {
    it('creates table, seeds single row, and loads initial state from database', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // CREATE TABLE
        .mockResolvedValueOnce({ rows: [] }) // INSERT INTO ... ON CONFLICT
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

      await initializePauseState();

      expect(mockQuery).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('CREATE TABLE IF NOT EXISTS pause_state'),
      );
      expect(mockQuery).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('INSERT INTO pause_state'),
      );
      expect(mockQuery).toHaveBeenNthCalledWith(
        3,
        'SELECT is_paused, paused_at, reason, contracts FROM pause_state LIMIT 1',
      );
      expect(mockLogger.info).toHaveBeenCalledWith('Pause guard initialized');
    });

    it('logs error and rethrows when initialization query fails', async () => {
      const initError = new Error('Database relation does not exist');
      mockQuery.mockRejectedValueOnce(initError);

      await expect(initializePauseState()).rejects.toThrow('Database relation does not exist');

      expect(mockLogger.error).toHaveBeenCalledWith('Failed to initialize pause state', {
        error: initError,
      });
    });
  });
});
