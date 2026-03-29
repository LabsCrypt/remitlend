import type { Request, Response } from "express";
import { query } from "../db/connection.js";
import { EventIndexer } from "../services/eventIndexer.js";
import { cacheService } from "../services/cacheService.js";
import {
  SUPPORTED_WEBHOOK_EVENT_TYPES,
  webhookService,
  type WebhookEventType,
} from "../services/webhookService.js";
import {
  createCursorPaginatedResponse,
  parseCursorQueryParams,
  parseQueryParams,
} from "../utils/pagination.js";
import logger from "../utils/logger.js";
import { getStellarRpcUrl } from "../config/stellar.js";

const buildEventFilters = (
  req: Request,
  baseParams: unknown[],
  initialWhereClause: string,
) => {
  const { status, dateRange, amountRange } = parseQueryParams(req);
  const params = [...baseParams];
  let whereClause = initialWhereClause;

  const appendCondition = (condition: string) => {
    whereClause += whereClause.includes("WHERE")
      ? ` AND ${condition}`
      : ` WHERE ${condition}`;
  };

  const requestedStatus =
    status && status !== "all"
      ? status
      : typeof req.query.eventType === "string"
        ? req.query.eventType
        : null;

  if (requestedStatus) {
    params.push(requestedStatus);
    appendCondition(`event_type = $${params.length}`);
  }

  if (amountRange) {
    params.push(amountRange.min, amountRange.max);
    appendCondition(
      `CAST(amount AS NUMERIC) BETWEEN $${params.length - 1} AND $${params.length}`,
    );
  }

  if (dateRange) {
    params.push(dateRange.start.toISOString(), dateRange.end.toISOString());
    appendCondition(
      `ledger_closed_at BETWEEN $${params.length - 1} AND $${params.length}`,
    );
  }

  return { params, whereClause };
};

const buildEventsCacheKey = (
  scope: string,
  resourceId: string | number,
  req: Request,
) =>
  [
    "events",
    scope,
    String(resourceId),
    `limit:${req.query.limit ?? "default"}`,
    `cursor:${req.query.cursor ?? "default"}`,
    `offset:${req.query.offset ?? "default"}`,
    `sort:${req.query.sort ?? "default"}`,
    `status:${req.query.status ?? req.query.eventType ?? "all"}`,
    `date:${req.query.date_range ?? "all"}`,
    `amount:${req.query.amount_range ?? "all"}`,
  ].join(":");

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
        totalEvents: Number.parseInt(totalEvents.rows[0].total, 10),
        eventsByType: eventCounts.rows.reduce(
          (acc, row) => {
            acc[row.event_type] = Number.parseInt(row.count, 10);
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
    const borrowerParam = req.params.borrower;
    const borrower = Array.isArray(borrowerParam)
      ? borrowerParam[0]
      : borrowerParam;
    if (!borrower) {
      return res.status(400).json({
        success: false,
        message: "Borrower is required",
      });
    }

    const { limit, cursor } = parseCursorQueryParams(req);
    const cacheKey = buildEventsCacheKey("borrower", borrower, req);
    const cachedData = await cacheService.get(cacheKey);

    if (cachedData) {
      res.json(cachedData);
      return;
    }

    const { params, whereClause } = buildEventFilters(
      req,
      [borrower],
      "WHERE borrower = $1",
    );
    console.log("DEBUG getBorrowerEvents after filters", {
      params,
      whereClause,
    });
    const cursorValue = cursor ? Number.parseInt(cursor, 10) : null;
    const cursorClause = `${whereClause.trim().length ? "AND" : "WHERE"} ($${params.length + 1}::int IS NULL OR id > $${params.length + 1})`;
    const queryText = `
      SELECT event_id, event_type, loan_id, borrower, amount,
             ledger, ledger_closed_at, tx_hash, created_at, id
      FROM loan_events
      ${whereClause}
      ${cursorClause}
      ORDER BY id ASC
      LIMIT $${params.length + 2}
    `;
    console.log("DEBUG getBorrowerEvents query", {
      queryText,
      queryParams: [...params, cursorValue, limit + 1],
    });

    const [result, totalCount] = await Promise.all([
      query(queryText, [...params, cursorValue, limit + 1]),
      query(`SELECT COUNT(*) as count FROM loan_events ${whereClause}`, params),
    ]);

    console.log("DEBUG getBorrowerEvents after query", { result, totalCount });
    const hasNext = result.rows.length > limit;
    const events = hasNext ? result.rows.slice(0, limit) : result.rows;
    const lastEvent = events.length > 0 ? events[events.length - 1] : undefined;
    const nextCursor = hasNext && lastEvent ? String(lastEvent.id) : null;

    const response = createCursorPaginatedResponse(
      {
        borrower,
        events,
      },
      Number.parseInt(totalCount.rows[0].count, 10),
      limit,
      events.length,
      nextCursor,
      Boolean(cursor),
    );

    await cacheService.set(cacheKey, response, 300);
    res.json(response);
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
    const loanIdParam = req.params.loanId;
    const loanId = Array.isArray(loanIdParam) ? loanIdParam[0] : loanIdParam;
    const { limit, cursor } = parseCursorQueryParams(req);

    if (!loanId) {
      return res.status(400).json({
        success: false,
        message: "Loan ID is required",
      });
    }

    const cacheKey = buildEventsCacheKey("loan", loanId, req);
    const cachedData = await cacheService.get(cacheKey);

    if (cachedData) {
      res.json(cachedData);
      return;
    }

    const { params, whereClause } = buildEventFilters(
      req,
      [loanId],
      "WHERE loan_id = $1",
    );
    const cursorValue = cursor ? Number.parseInt(cursor, 10) : null;
    const cursorClause = `${whereClause.trim().length ? "AND" : "WHERE"} ($${params.length + 1}::int IS NULL OR id > $${params.length + 1})`;
    const queryText = `
      SELECT event_id, event_type, loan_id, borrower, amount,
             ledger, ledger_closed_at, tx_hash, created_at, id
      FROM loan_events
      ${whereClause}
      ${cursorClause}
      ORDER BY id ASC
      LIMIT $${params.length + 2}
    `;

    const [result, totalCount] = await Promise.all([
      query(queryText, [...params, cursorValue, limit + 1]),
      query(`SELECT COUNT(*) as count FROM loan_events ${whereClause}`, params),
    ]);

    const hasNext = result.rows.length > limit;
    const events = hasNext ? result.rows.slice(0, limit) : result.rows;
    const lastEvent = events.length > 0 ? events[events.length - 1] : undefined;
    const nextCursor = hasNext && lastEvent ? String(lastEvent.id) : null;

    const response = createCursorPaginatedResponse(
      {
        loanId: Number.parseInt(loanId, 10),
        events,
      },
      Number.parseInt(totalCount.rows[0].count, 10),
      limit,
      events.length,
      nextCursor,
      Boolean(cursor),
    );

    await cacheService.set(cacheKey, response, 300);
    res.json(response);
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
    const { limit, cursor } = parseCursorQueryParams(req);
    const cacheKey = buildEventsCacheKey("recent", "all", req);
    const cachedData = await cacheService.get(cacheKey);

    if (cachedData) {
      res.json(cachedData);
      return;
    }

    const { params, whereClause } = buildEventFilters(req, [], "");
    const cursorValue = cursor ? Number.parseInt(cursor, 10) : null;
    const cursorClause = `${whereClause.trim().length ? "AND" : "WHERE"} ($${params.length + 1}::int IS NULL OR id > $${params.length + 1})`;
    const queryText = `
      SELECT event_id, event_type, loan_id, borrower, amount,
             ledger, ledger_closed_at, tx_hash, created_at, id
      FROM loan_events
      ${whereClause}
      ${cursorClause}
      ORDER BY id ASC
      LIMIT $${params.length + 2}
    `;

    const [result, totalCount] = await Promise.all([
      query(queryText, [...params, cursorValue, limit + 1]),
      query(`SELECT COUNT(*) as count FROM loan_events ${whereClause}`, params),
    ]);

    console.log("DEBUG getRecentEvents", {
      queryResult: result.rows,
      countResult: totalCount.rows,
    });
    const hasNext = result.rows.length > limit;
    const events = hasNext ? result.rows.slice(0, limit) : result.rows;
    const lastEvent = events.length > 0 ? events[events.length - 1] : undefined;
    const nextCursor = hasNext && lastEvent ? String(lastEvent.id) : null;

    const response = createCursorPaginatedResponse(
      {
        events,
      },
      Number.parseInt(totalCount.rows[0].count, 10),
      limit,
      events.length,
      nextCursor,
      Boolean(cursor),
    );

    await cacheService.set(cacheKey, response, 120);
    res.json(response);
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
    const subscriptionId = Number(req.params.id ?? req.params.subscriptionId);

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

export const getWebhookDeliveries = async (req: Request, res: Response) => {
  try {
    const subscriptionId = Number(req.params.id ?? req.params.subscriptionId);
    const limit = Number(req.query.limit ?? 50);

    if (!Number.isInteger(subscriptionId) || subscriptionId <= 0) {
      return res.status(400).json({
        success: false,
        message: "subscription id must be a positive integer",
      });
    }

    const boundedLimit =
      Number.isFinite(limit) && limit > 0 ? Math.min(limit, 200) : 50;

    const deliveries = await webhookService.getSubscriptionDeliveries(
      subscriptionId,
      boundedLimit,
    );

    res.json({
      success: true,
      data: {
        subscriptionId,
        deliveries,
      },
    });
  } catch (error) {
    logger.error("Failed to fetch webhook deliveries", { error });
    res.status(500).json({
      success: false,
      message: "Failed to fetch webhook deliveries",
    });
  }
};

export const reindexLedgerRange = async (req: Request, res: Response) => {
  try {
    const fromLedger = Number(req.query.fromLedger);
    const toLedger = Number(req.query.toLedger);

    if (!Number.isInteger(fromLedger) || !Number.isInteger(toLedger)) {
      return res.status(400).json({
        success: false,
        message: "fromLedger and toLedger must be integers",
      });
    }

    if (fromLedger <= 0 || toLedger <= 0 || fromLedger > toLedger) {
      return res.status(400).json({
        success: false,
        message: "Ledger range is invalid",
      });
    }

    const maxRange = Number(process.env.REINDEX_MAX_RANGE ?? 25000);
    const requestedRange = toLedger - fromLedger + 1;
    if (requestedRange > maxRange) {
      return res.status(400).json({
        success: false,
        message: `Requested range exceeds maximum of ${maxRange} ledgers`,
      });
    }

    const contractId = process.env.LOAN_MANAGER_CONTRACT_ID;

    if (!contractId) {
      return res.status(500).json({
        success: false,
        message: "LOAN_MANAGER_CONTRACT_ID is not configured",
      });
    }

    const rpcUrl = getStellarRpcUrl();
    const batchSize = Number(process.env.INDEXER_BATCH_SIZE ?? 100);
    const indexer = new EventIndexer({
      rpcUrl,
      contractId,
      pollIntervalMs: 30_000,
      batchSize,
    });

    const result = await indexer.reindexRange(fromLedger, toLedger);

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error("Failed to reindex ledger range", { error });
    res.status(500).json({
      success: false,
      message: "Failed to reindex ledger range",
    });
  }
};
