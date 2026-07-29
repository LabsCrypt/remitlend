import type { Router, Request, Response, NextFunction } from 'express';
import { getPauseState } from '../middleware/pauseGuard.js';

/**
 * Status endpoints - public API for system health and state.
 * Issue #1381: Pause state coordination across layers.
 */
export function registerStatusRoutes(router: Router): void {
  /**
   * GET /api/status/pause
   *
   * Returns the current global pause state.
   * Used by frontend to display pause banner and disable mutating operations.
   * Available without authentication.
   *
   * Response:
   * {
   *   success: true,
   *   data: {
   *     isPaused: boolean,
   *     pausedAt: ISO timestamp | null,
   *     reason: string | null,
   *     contracts: string[],
   *     timestamp: ISO timestamp
   *   }
   * }
   */
  router.get('/api/status/pause', getPauseState);
}
