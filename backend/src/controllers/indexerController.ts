import { Request, Response } from "express";
import { query } from "../db/connection.js";
import logger from "../utils/logger.js";
import { EventIndexer } from "../services/eventIndexer.js";
import {
  SUPPORTED_WEBHOOK_EVENT_TYPES,
  webhookService,
  type WebhookEventType,
} from "../services/webhookService.js";
import { cacheService } from "../services/cacheService.js";

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

    const cacheKey = `events:borrower:${borrower}:limit:${limit}:offset:${offset}`;
    const cachedData = await cacheService.get(cacheKey);

    if (cachedData) {
      res.json({
        success: true,
        data: cachedData,
      });
      return;
    }

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

    const data = {
      events: result.rows,
      pagination: {
        total: parseInt(total.rows[0].count),
        limit: parseInt(limit as string),
        offset: parseInt(offset as string),
      },
    };

    await cacheService.set(cacheKey, data, 300); // 5 minutes TTL

    res.json({
      success: true,
      data,
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

    const cacheKey = `events:loan:${loanId}`;
    const cachedData = await cacheService.get(cacheKey);

    if (cachedData) {
      res.json({
        success: true,
        data: cachedData,
      });
      return;
    }

    const result = await query(
      `SELECT event_id, event_type, loan_id, borrower, amount, 
              ledger, ledger_closed_at, tx_hash, created_at
       FROM loan_events
       WHERE loan_id = $1
       ORDER BY ledger ASC`,
      [loanId],
    );

    const data = {
      loanId: parseInt(loanId as string),
      events: result.rows,
    };

    await cacheService.set(cacheKey, data, 300); // 5 minutes TTL

    res.json({
      success: true,
      data,
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

    const cacheKey = `events:recent:limit:${limit}:type:${eventType || "all"}`;
    const cachedData = await cacheService.get(cacheKey);

    if (cachedData) {
      res.json({
        success: true,
        data: cachedData,
      });
      return;
    }

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

    const data = {
      events: result.rows,
    };

    await cacheService.set(cacheKey, data, 120); // 2 minutes TTL for recent events

    res.json({
      success: true,
      data,
    });
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

    const rpcUrl =
      process.env.STELLAR_RPC_URL || "https://soroban-testnet.stellar.org";
    const contractId = process.env.LOAN_MANAGER_CONTRACT_ID;

    if (!contractId) {
      return res.status(500).json({
        success: false,
        message: "LOAN_MANAGER_CONTRACT_ID is not configured",
      });
    }

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
