import { Request, Response } from "express";
import { query } from "../db/connection.js";
import logger from "../utils/logger.js";

/**
 * Get indexer status
 */
export const getIndexerStatus = async (req: Request, res: Response) => {
  try {
    const result = await query(
      "SELECT last_indexed_ledger, last_indexed_cursor, updated_at FROM indexer_state ORDER BY id DESC LIMIT 1",
      [],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Indexer state not found",
      });
    }

    const state = result.rows[0];

    // Get event counts
    const eventCounts = await query(
      `SELECT event_type, COUNT(*) as count 
       FROM loan_events 
       GROUP BY event_type`,
      [],
    );

    const totalEvents = await query(
      "SELECT COUNT(*) as total FROM loan_events",
      [],
    );

    res.json({
      success: true,
      data: {
        lastIndexedLedger: state.last_indexed_ledger,
        lastIndexedCursor: state.last_indexed_cursor,
        lastUpdated: state.updated_at,
        totalEvents: parseInt(totalEvents.rows[0].total),
        eventsByType: eventCounts.rows.reduce(
          (acc, row) => {
            acc[row.event_type] = parseInt(row.count);
            return acc;
          },
          {} as Record<string, number>,
        ),
      },
    });
  } catch (error) {
    logger.error("Failed to get indexer status", { error });
    res.status(500).json({
      success: false,
      message: "Failed to get indexer status",
    });
  }
};

/**
 * Get loan events for a specific borrower
 */
export const getBorrowerEvents = async (req: Request, res: Response) => {
  try {
    const { borrower } = req.params;
    const { limit = 50, offset = 0 } = req.query;

    const result = await query(
      `SELECT event_id, event_type, loan_id, borrower, amount, 
              ledger, ledger_closed_at, tx_hash, created_at
       FROM loan_events
       WHERE borrower = $1
       ORDER BY ledger DESC
       LIMIT $2 OFFSET $3`,
      [borrower, limit, offset],
    );

    const total = await query(
      "SELECT COUNT(*) as count FROM loan_events WHERE borrower = $1",
      [borrower],
    );

    res.json({
      success: true,
      data: {
        events: result.rows,
        pagination: {
          total: parseInt(total.rows[0].count),
          limit: parseInt(limit as string),
          offset: parseInt(offset as string),
        },
      },
    });
  } catch (error) {
    logger.error("Failed to get borrower events", { error });
    res.status(500).json({
      success: false,
      message: "Failed to get borrower events",
    });
  }
};

/**
 * Get events for a specific loan
 */
export const getLoanEvents = async (req: Request, res: Response) => {
  try {
    const { loanId } = req.params;

    if (!loanId) {
      return res.status(400).json({
        success: false,
        message: "Loan ID is required",
      });
    }

    const result = await query(
      `SELECT event_id, event_type, loan_id, borrower, amount, 
              ledger, ledger_closed_at, tx_hash, created_at
       FROM loan_events
       WHERE loan_id = $1
       ORDER BY ledger ASC`,
      [loanId],
    );

    res.json({
      success: true,
      data: {
        loanId: parseInt(loanId as string),
        events: result.rows,
      },
    });
  } catch (error) {
    logger.error("Failed to get loan events", { error });
    res.status(500).json({
      success: false,
      message: "Failed to get loan events",
    });
  }
};

/**
 * Get recent events
 */
export const getRecentEvents = async (req: Request, res: Response) => {
  try {
    const { limit = 20, eventType } = req.query;

    let queryText = `
      SELECT event_id, event_type, loan_id, borrower, amount, 
             ledger, ledger_closed_at, tx_hash, created_at
      FROM loan_events
    `;

    const params: unknown[] = [];

    if (eventType) {
      queryText += " WHERE event_type = $1";
      params.push(eventType);
    }

    queryText += ` ORDER BY ledger DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await query(queryText, params);

    res.json({
      success: true,
      data: {
        events: result.rows,
      },
    });
  } catch (error) {
    logger.error("Failed to get recent events", { error });
    res.status(500).json({
      success: false,
      message: "Failed to get recent events",
    });
  }
};
