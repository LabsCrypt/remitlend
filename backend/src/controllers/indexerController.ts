import { Request, Response } from "express";
import { query } from "../db/connection.js";
import logger from "../utils/logger.js";
import {
  SUPPORTED_WEBHOOK_EVENT_TYPES,
  webhookService,
  type WebhookEventType,
} from "../services/webhookService.js";
import { parseQueryParams, createPaginatedResponse } from "../utils/pagination.js";

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
    const { limit, offset, sort, status, dateRange, amountRange } = parseQueryParams(req);

    const params: unknown[] = [borrower];
    let whereClause = "WHERE borrower = $1";

    if (status && status !== "all") {
      params.push(status);
      whereClause += ` AND event_type = $${params.length}`;
    }
    if (amountRange) {
      params.push(amountRange.min, amountRange.max);
      whereClause += ` AND CAST(amount AS NUMERIC) BETWEEN $${params.length - 1} AND $${params.length}`;
    }
    if (dateRange) {
      params.push(dateRange.start.toISOString(), dateRange.end.toISOString());
      whereClause += ` AND ledger_closed_at BETWEEN $${params.length - 1} AND $${params.length}`;
    }

    let orderField = "ledger";
    let orderDir = "DESC";
    if (sort) {
      orderDir = sort.startsWith("-") ? "DESC" : "ASC";
      orderField = sort.replace(/^-/, "");
      const allowedVars = ["event_type", "amount", "ledger", "ledger_closed_at"];
      if (!allowedVars.includes(orderField)) orderField = "ledger";
    }

    const queryText = `
      SELECT event_id, event_type, loan_id, borrower, amount, 
             ledger, ledger_closed_at, tx_hash, created_at
      FROM loan_events
      ${whereClause}
      ORDER BY ${orderField} ${orderDir}
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    const result = await query(queryText, [...params, limit, offset]);
    const totalCount = await query(`SELECT COUNT(*) as count FROM loan_events ${whereClause}`, params);

    res.json(createPaginatedResponse(result.rows, parseInt(totalCount.rows[0].count), limit, offset));
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
    const { limit, offset, sort, status, dateRange, amountRange } = parseQueryParams(req);

    if (!loanId) {
      return res.status(400).json({
        success: false,
        message: "Loan ID is required",
      });
    }

    const params: unknown[] = [loanId];
    let whereClause = "WHERE loan_id = $1";

    if (status && status !== "all") {
      params.push(status);
      whereClause += ` AND event_type = $${params.length}`;
    }
    if (amountRange) {
      params.push(amountRange.min, amountRange.max);
      whereClause += ` AND CAST(amount AS NUMERIC) BETWEEN $${params.length - 1} AND $${params.length}`;
    }
    if (dateRange) {
      params.push(dateRange.start.toISOString(), dateRange.end.toISOString());
      whereClause += ` AND ledger_closed_at BETWEEN $${params.length - 1} AND $${params.length}`;
    }

    let orderField = "ledger";
    let orderDir = "ASC";
    if (sort) {
      orderDir = sort.startsWith("-") ? "DESC" : "ASC";
      orderField = sort.replace(/^-/, "");
      const allowedVars = ["event_type", "amount", "ledger", "ledger_closed_at"];
      if (!allowedVars.includes(orderField)) orderField = "ledger";
    }

    const queryText = `
      SELECT event_id, event_type, loan_id, borrower, amount, 
             ledger, ledger_closed_at, tx_hash, created_at
      FROM loan_events
      ${whereClause}
      ORDER BY ${orderField} ${orderDir}
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    const result = await query(queryText, [...params, limit, offset]);
    const totalCount = await query(`SELECT COUNT(*) as count FROM loan_events ${whereClause}`, params);

    res.json(createPaginatedResponse(result.rows, parseInt(totalCount.rows[0].count), limit, offset));
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
    const { limit, offset, sort, status, dateRange, amountRange } = parseQueryParams(req);

    const params: unknown[] = [];
    let whereClause = "";

    const addWhere = (condition: string) => {
      whereClause += whereClause === "" ? `WHERE ${condition}` : ` AND ${condition}`;
    };

    if (status && status !== "all") {
      params.push(status);
      addWhere(`event_type = $${params.length}`);
    } else if (req.query.eventType) {
      // Backwards compatibility with eventType param
      params.push(req.query.eventType);
      addWhere(`event_type = $${params.length}`);
    }
    
    if (amountRange) {
      params.push(amountRange.min, amountRange.max);
      addWhere(`CAST(amount AS NUMERIC) BETWEEN $${params.length - 1} AND $${params.length}`);
    }
    if (dateRange) {
      params.push(dateRange.start.toISOString(), dateRange.end.toISOString());
      addWhere(`ledger_closed_at BETWEEN $${params.length - 1} AND $${params.length}`);
    }

    let orderField = "ledger";
    let orderDir = "DESC";
    if (sort) {
      orderDir = sort.startsWith("-") ? "DESC" : "ASC";
      orderField = sort.replace(/^-/, "");
      const allowedVars = ["event_type", "amount", "ledger", "ledger_closed_at"];
      if (!allowedVars.includes(orderField)) orderField = "ledger";
    }

    const queryText = `
      SELECT event_id, event_type, loan_id, borrower, amount, 
             ledger, ledger_closed_at, tx_hash, created_at
      FROM loan_events
      ${whereClause}
      ORDER BY ${orderField} ${orderDir}
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    const result = await query(queryText, [...params, limit, offset]);
    const totalCount = await query(`SELECT COUNT(*) as count FROM loan_events ${whereClause}`, params);

    res.json(createPaginatedResponse(result.rows, parseInt(totalCount.rows[0].count), limit, offset));
  } catch (error) {
    logger.error("Failed to get recent events", { error });
    res.status(500).json({
      success: false,
      message: "Failed to get recent events",
    });
  }
};

export const listWebhookSubscriptions = async (
  _req: Request,
  res: Response,
) => {
  try {
    const subscriptions = await webhookService.listSubscriptions();

    res.json({
      success: true,
      data: {
        subscriptions,
      },
    });
  } catch (error) {
    logger.error("Failed to list webhook subscriptions", { error });
    res.status(500).json({
      success: false,
      message: "Failed to list webhook subscriptions",
    });
  }
};

export const createWebhookSubscription = async (
  req: Request,
  res: Response,
) => {
  try {
    const { callbackUrl, eventTypes, secret } = req.body as {
      callbackUrl?: string;
      eventTypes?: string[];
      secret?: string;
    };

    if (!callbackUrl) {
      return res.status(400).json({
        success: false,
        message: "callbackUrl is required",
      });
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(callbackUrl);
    } catch {
      return res.status(400).json({
        success: false,
        message: "callbackUrl must be a valid URL",
      });
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return res.status(400).json({
        success: false,
        message: "callbackUrl must use http or https",
      });
    }

    const normalizedEventTypes = Array.isArray(eventTypes)
      ? eventTypes.filter((eventType): eventType is WebhookEventType =>
          SUPPORTED_WEBHOOK_EVENT_TYPES.includes(eventType as WebhookEventType),
        )
      : [];

    if (normalizedEventTypes.length === 0) {
      return res.status(400).json({
        success: false,
        message: `eventTypes must include at least one of: ${SUPPORTED_WEBHOOK_EVENT_TYPES.join(", ")}`,
      });
    }

    const subscription = await webhookService.registerSubscription(
      secret
        ? {
            callbackUrl,
            eventTypes: normalizedEventTypes,
            secret,
          }
        : {
            callbackUrl,
            eventTypes: normalizedEventTypes,
          },
    );

    res.status(201).json({
      success: true,
      data: {
        subscription,
      },
    });
  } catch (error) {
    logger.error("Failed to create webhook subscription", { error });
    res.status(500).json({
      success: false,
      message: "Failed to create webhook subscription",
    });
  }
};

export const deleteWebhookSubscription = async (
  req: Request,
  res: Response,
) => {
  try {
    const subscriptionId = Number(req.params.subscriptionId);

    if (!Number.isInteger(subscriptionId) || subscriptionId <= 0) {
      return res.status(400).json({
        success: false,
        message: "subscriptionId must be a positive integer",
      });
    }

    const deleted = await webhookService.deleteSubscription(subscriptionId);
    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "Webhook subscription not found",
      });
    }

    res.json({
      success: true,
      message: "Webhook subscription deleted",
    });
  } catch (error) {
    logger.error("Failed to delete webhook subscription", { error });
    res.status(500).json({
      success: false,
      message: "Failed to delete webhook subscription",
    });
  }
};
