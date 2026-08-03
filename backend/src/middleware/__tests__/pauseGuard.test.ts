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

const { pauseGuard, setPauseState, getCurrentPauseState } = await import('../pauseGuard.js');
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
});
