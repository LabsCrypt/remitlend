import type { Request, Response } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { query } from "../db/connection.js";
import { AppError } from "../errors/AppError.js";
import { eventStreamService } from "../services/eventStreamService.js";
import logger from "../utils/logger.js";

/**
 * GET /api/events/stream?borrower=G...
 *
 * SSE endpoint for real-time loan events.
 * - With `?borrower=G...` — streams events for that specific borrower (requires JWT matching)
 * - Without `?borrower` — streams all events (requires API key for admin access)
 */
export const streamEvents = asyncHandler(
  async (req: Request, res: Response) => {
    const borrower = req.query.borrower as string | undefined;

    // SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    // Heartbeat to keep connection alive through proxies/load balancers
    const heartbeat = setInterval(() => {
      try {
        res.write(": heartbeat\n\n");
      } catch {
        // client already gone
      }
    }, 30_000);

    let unsubscribe: () => void;

    if (borrower) {
      // Send recent events on connect so client has context
      try {
        const recentEvents = await query(
          `SELECT event_id, event_type, loan_id, borrower, amount, ledger, ledger_closed_at, tx_hash
           FROM loan_events
           WHERE borrower = $1
           ORDER BY ledger_closed_at DESC
           LIMIT 20`,
          [borrower],
        );

        if (recentEvents.rows.length > 0) {
          const initData = recentEvents.rows
            .reverse()
            .map((row: Record<string, unknown>) => ({
              eventId: row.event_id,
              eventType: row.event_type,
              loanId: row.loan_id,
              borrower: row.borrower,
              amount: row.amount,
              ledger: row.ledger,
              ledgerClosedAt: row.ledger_closed_at,
              txHash: row.tx_hash,
            }));
          res.write(
            `data: ${JSON.stringify({ type: "init", events: initData })}\n\n`,
          );
        }
      } catch (err) {
        logger.error("SSE init fetch error", { borrower, err });
      }

      unsubscribe = eventStreamService.subscribeBorrower(borrower, res);
    } else {
      // Admin stream — send connection count
      const counts = eventStreamService.getConnectionCount();
      res.write(
        `data: ${JSON.stringify({ type: "init", connections: counts })}\n\n`,
      );
      unsubscribe = eventStreamService.subscribeAll(res);
    }

    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };

    req.on("close", cleanup);
    req.on("error", cleanup);
  },
);

/**
 * GET /api/events/status
 *
 * Returns the current SSE connection counts (admin use).
 */
export const getEventStreamStatus = asyncHandler(
  async (_req: Request, res: Response) => {
    const counts = eventStreamService.getConnectionCount();
    res.json({ success: true, data: counts });
  },
);
