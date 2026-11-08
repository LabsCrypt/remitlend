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

  describe('concurrent pause state transitions & state races (#2093)', () => {
    it('handles concurrent setPauseState calls and maintains valid state', async () => {
      const updates = Array.from({ length: 10 }, (_, i) =>
        setPauseState(i % 2 === 0, [`CONTRACT_${i}`], `Reason ${i}`),
      );
      await Promise.all(updates);

      const finalState = getCurrentPauseState();
      expect(typeof finalState.isPaused).toBe('boolean');
      expect(Array.isArray(finalState.contracts)).toBe(true);
      expect(typeof finalState.reason).toBe('string');
    });

    it('rejects loan mutation as soon as pause state transitions from unpaused to paused', async () => {
      await setPauseState(false, []);
      const req = { method: 'POST', path: '/api/loans/disburse' } as Request;

      // Initial request allowed
      pauseGuard(req, mockResponse as Response, mockNext);
      expect(mockNext).toHaveBeenCalledTimes(1);

      // Emergency pause triggers
      await setPauseState(true, ['LOAN_ESCROW'], 'Liquidity drain detected');

      // Subsequent mutating request immediately rejected
      expect(() => pauseGuard(req, mockResponse as Response, mockNext)).toThrow(AppError);
      expect(mockNext).toHaveBeenCalledTimes(1);
    });

    it('allows loan mutation as soon as pause state transitions from paused to unpaused', async () => {
      await setPauseState(true, ['LOAN_ESCROW'], 'Temporary lock');
      const req = { method: 'POST', path: '/api/loans/repay' } as Request;

      expect(() => pauseGuard(req, mockResponse as Response, mockNext)).toThrow(AppError);

      // Unpause triggers
      await setPauseState(false, []);

      // Subsequent mutating request immediately succeeds
      const next = jest.fn();
      pauseGuard(req, mockResponse as Response, next);
      expect(next).toHaveBeenCalledWith();
    });

    it('formats error message with fallback reason when reason is null or omitted', async () => {
      await setPauseState(true, []);
      const req = { method: 'POST', path: '/api/loans/repay' } as Request;

      try {
        pauseGuard(req, mockResponse as Response, mockNext);
        throw new Error('should have thrown AppError');
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as InstanceType<typeof AppError>).message).toContain(
          'Reason: Maintenance or security measure',
        );
        expect((err as InstanceType<typeof AppError>).message).toContain('Affected contracts: ');
      }
    });

    it('preserves existing in-memory state when DB update query fails', async () => {
      await setPauseState(true, ['LOAN_CONTRACT'], 'Critical vulnerability');
      mockQuery.mockRejectedValueOnce(new Error('DB pool timeout'));

      await updatePauseStateFromDatabase();

      expect(getCurrentPauseState().isPaused).toBe(true);
      expect(getCurrentPauseState().reason).toBe('Critical vulnerability');
      expect(getCurrentPauseState().contracts).toEqual(['LOAN_CONTRACT']);
    });
  });

  describe('exempt route boundaries during active pause (#2093)', () => {
    beforeEach(async () => {
      await setPauseState(true, ['ALL'], 'Emergency Incident');
    });

    it.each([
      '/api/auth/login',
      '/api/v1/auth/session',
      '/api/admin/recovery',
      '/api/v1/admin/unpause',
      '/admin/status',
    ])('allows mutating write request to exempt path: %s', (path) => {
      const next = jest.fn();
      pauseGuard({ method: 'POST', path } as Request, {} as Response, next);
      expect(next).toHaveBeenCalledWith();
    });

    it.each([
      '/api/authentication/login',
      '/api/administrator/kill',
      '/api/loans/repay',
      '/api/v1/loans/apply',
      '/api/contracts/invoke',
    ])('blocks non-exempt path even if partially similar: %s', (path) => {
      const next = jest.fn();
      expect(() => pauseGuard({ method: 'POST', path } as Request, {} as Response, next)).toThrow(
        AppError,
      );
      expect(next).not.toHaveBeenCalled();
    });
  });
});
