import type { Request, Response } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { query } from "../db/connection.js";
import { AppError } from "../errors/AppError.js";
import { eventStreamService } from "../services/eventStreamService.js";
import logger from "../utils/logger.js";

const REPLAY_LIMIT = 100;

type DbEventRow = Record<string, unknown>;

const mapLoanEventRow = (row: DbEventRow) => ({
  eventId: row.event_id,
  eventType: row.event_type,
  loanId: row.loan_id,
  borrower: row.borrower,
  amount: row.amount,
  ledger: row.ledger,
  ledgerClosedAt: row.ledger_closed_at,
  txHash: row.tx_hash,
});

const parseLastEventId = (req: Request): string | null => {
  const headerValue = req.headers["last-event-id"];
  if (typeof headerValue === "string" && headerValue.trim().length > 0) {
    return headerValue.trim();
  }

  if (Array.isArray(headerValue) && headerValue[0]?.trim()) {
    return headerValue[0].trim();
  }

  return null;
};

/**
 * GET /api/events/stream?borrower=G...
 *
 * SSE endpoint for real-time loan events.
 * - With `?borrower=G...` — streams events for that specific borrower (requires JWT matching)
 * - Without `?borrower` — streams all events (requires API key for admin access)
 */
export const streamEvents = asyncHandler(
  async (req: Request, res: Response) => {
    const requestedBorrower =
      typeof req.query.borrower === "string" ? req.query.borrower : undefined;
    const lastEventId = parseLastEventId(req);
    const userKey = req.user?.publicKey;
    const role = req.user?.role;

    if (!userKey) {
      throw AppError.unauthorized("Authentication required");
    }

    const isAdmin = role === "admin";

    if (!isAdmin && requestedBorrower && requestedBorrower !== userKey) {
      throw AppError.forbidden(
        "Borrowers can only subscribe to their own events",
      );
    }

    const borrower = requestedBorrower ?? (isAdmin ? undefined : userKey);

    if (!eventStreamService.canOpenConnection(userKey)) {
      throw new AppError(
        `Maximum of ${eventStreamService.getMaxConnectionsPerUser()} SSE connections allowed per user`,
        429,
      );
    }

    // SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    let unsubscribe: () => void;

    if (borrower) {
      // Send replay events first (if Last-Event-ID is provided), otherwise
      // send recent events for initial context.
      try {
        const replayEvents = await query(
          `SELECT event_id, event_type, loan_id, borrower, amount, ledger, ledger_closed_at, tx_hash
           FROM loan_events
           WHERE borrower = $1
             AND (
               $2::text IS NULL
               OR id > COALESCE((SELECT id FROM loan_events WHERE event_id = $2), 0)
             )
           ORDER BY id ASC
           LIMIT $3`,
          [borrower, lastEventId, REPLAY_LIMIT],
        );

        if (replayEvents.rows.length > 0) {
          for (const row of replayEvents.rows) {
            eventStreamService.sendEvent(res, mapLoanEventRow(row as DbEventRow));
          }
        } else if (!lastEventId) {
          res.write(`event: init\ndata: ${JSON.stringify({ type: "init", replayed: 0 })}\n\n`);
        }
      } catch (err) {
        logger.error("SSE replay fetch error", { borrower, lastEventId, err });
      }

      unsubscribe = eventStreamService.subscribeBorrower(userKey, borrower, res);
    } else {
      try {
        const replayEvents = await query(
          `SELECT event_id, event_type, loan_id, borrower, amount, ledger, ledger_closed_at, tx_hash
           FROM loan_events
           WHERE (
             $1::text IS NULL
             OR id > COALESCE((SELECT id FROM loan_events WHERE event_id = $1), 0)
           )
           ORDER BY id ASC
           LIMIT $2`,
          [lastEventId, REPLAY_LIMIT],
        );

        if (replayEvents.rows.length > 0) {
          for (const row of replayEvents.rows) {
            eventStreamService.sendEvent(res, mapLoanEventRow(row as DbEventRow));
          }
        }
      } catch (err) {
        logger.error("SSE admin replay fetch error", { lastEventId, err });
      }

      const counts = eventStreamService.getConnectionCount();
      res.write(`event: init\ndata: ${JSON.stringify({ type: "init", connections: counts })}\n\n`);
      unsubscribe = eventStreamService.subscribeAll(userKey, res);
    }

    req.on("close", unsubscribe);
    req.on("error", unsubscribe);
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
