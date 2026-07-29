import type { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger.js';
import { AppError } from '../errors/AppError.js';
import { query } from '../db/connection.js';

/**
 * Tracks the global pause state across all contracts.
 * Updated via event indexer when pause/unpause events are detected.
 */
interface PauseState {
  isPaused: boolean;
  pausedAt: Date | null;
  reason: string | null;
  contracts: string[];
}

let globalPauseState: PauseState = {
  isPaused: false,
  pausedAt: null,
  reason: null,
  contracts: [],
};

/**
 * Updates the global pause state from the database.
 * Called periodically and after pause/unpause events.
 */
export async function updatePauseStateFromDatabase(): Promise<void> {
  try {
    const result = await query<{
      is_paused: boolean;
      paused_at: Date | null;
      reason: string | null;
      contracts: string[];
    }>('SELECT is_paused, paused_at, reason, contracts FROM pause_state LIMIT 1');

    if (result.rows.length > 0) {
      const row = result.rows[0];
      globalPauseState = {
        isPaused: row.is_paused,
        pausedAt: row.paused_at,
        reason: row.reason,
        contracts: row.contracts || [],
      };
    }
  } catch (error) {
    logger.error('Failed to update pause state from database', { error });
    // Fail open: don't block requests if database is unavailable
  }
}

/**
 * Middleware to enforce pause state on state-mutating operations.
 * Rejects write requests (POST, PUT, PATCH, DELETE) when contracts are paused.
 *
 * Returns:
 * - 200 with pause state info on GET requests (read-only, allowed)
 * - 200 with pause state info on OPTIONS requests (allowed)
 * - 503 Service Unavailable if mutating request during pause
 */
export function pauseGuard(req: Request, res: Response, next: NextFunction): void {
  // Allow read-only operations
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }

  // Check if contracts are paused
  if (globalPauseState.isPaused) {
    logger.warn('Request rejected due to contract pause', {
      method: req.method,
      path: req.path,
      contracts: globalPauseState.contracts,
      reason: globalPauseState.reason,
    });

    // Return 503 Service Unavailable with pause info
    throw AppError.serviceUnavailable(
      `Contract operations are temporarily paused. Reason: ${globalPauseState.reason || 'Maintenance or security measure'}. ` +
        `Affected contracts: ${globalPauseState.contracts.join(', ')}`,
    );
  }

  next();
}

/**
 * Endpoint to check current pause state.
 * Available to all clients without authentication.
 */
export async function getPauseState(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // Refresh pause state from database
    await updatePauseStateFromDatabase();

    res.json({
      success: true,
      data: {
        isPaused: globalPauseState.isPaused,
        pausedAt: globalPauseState.pausedAt,
        reason: globalPauseState.reason,
        contracts: globalPauseState.contracts,
        timestamp: new Date(),
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Called by eventIndexer when pause events are detected on any contract.
 * Updates database and global state.
 */
export async function setPauseState(
  isPaused: boolean,
  contracts: string[],
  reason?: string,
): Promise<void> {
  try {
    const now = isPaused ? new Date() : null;

    // Upsert pause state in database
    await query(
      `INSERT INTO pause_state (id, is_paused, paused_at, reason, contracts, updated_at)
       VALUES (1, $1, $2, $3, $4, NOW())
       ON CONFLICT (id) DO UPDATE SET
         is_paused = $1,
         paused_at = $2,
         reason = $3,
         contracts = $4,
         updated_at = NOW()`,
      [isPaused, now, reason || null, JSON.stringify(contracts)],
    );

    // Update in-memory state
    globalPauseState = {
      isPaused,
      pausedAt: now,
      reason: reason || null,
      contracts,
    };

    logger.info('Pause state updated', {
      isPaused,
      contracts,
      reason,
    });
  } catch (error) {
    logger.error('Failed to set pause state', { error, isPaused, contracts, reason });
    throw error;
  }
}

/**
 * Initialize pause state from database on startup.
 */
export async function initializePauseState(): Promise<void> {
  try {
    // Create pause_state table if it doesn't exist
    await query(
      `CREATE TABLE IF NOT EXISTS pause_state (
        id BIGINT PRIMARY KEY,
        is_paused BOOLEAN NOT NULL DEFAULT false,
        paused_at TIMESTAMP WITH TIME ZONE,
        reason TEXT,
        contracts TEXT[] DEFAULT '{}',
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )`,
    );

    // Ensure we have exactly one row
    await query(
      `INSERT INTO pause_state (id, is_paused, paused_at, reason, contracts, updated_at)
       VALUES (1, false, NULL, NULL, '{}', NOW())
       ON CONFLICT (id) DO NOTHING`,
    );

    // Load initial state
    await updatePauseStateFromDatabase();

    logger.info('Pause guard initialized');
  } catch (error) {
    logger.error('Failed to initialize pause state', { error });
    throw error;
  }
}

/**
 * Get current pause state (for internal use).
 */
export function getCurrentPauseState(): PauseState {
  return globalPauseState;
}
