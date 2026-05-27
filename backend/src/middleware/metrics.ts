import type { NextFunction, Request, Response } from "express";
import client from "prom-client";
import { query } from "../db/connection.js";
import logger from "../utils/logger.js";

export const metricsRegistry = new client.Registry();

client.collectDefaultMetrics({ register: metricsRegistry });

export const indexerLastLedgerGauge = new client.Gauge({
  name: "indexer_last_ledger",
  help: "Last ledger successfully processed by the event indexer.",
  registers: [metricsRegistry],
});

export const indexerChainTipGauge = new client.Gauge({
  name: "indexer_chain_tip",
  help: "Latest ledger observed from the chain RPC.",
  registers: [metricsRegistry],
});

export const indexerLagLedgersGauge = new client.Gauge({
  name: "indexer_lag_ledgers",
  help: "Difference between the latest chain ledger and the last indexed ledger.",
  registers: [metricsRegistry],
});

export const webhookRetryQueueDepthGauge = new client.Gauge({
  name: "webhook_retry_queue_depth",
  help: "Number of webhook deliveries currently waiting for retry.",
  registers: [metricsRegistry],
});

export const scoreReconciliationLastRunTimestampGauge = new client.Gauge({
  name: "score_reconciliation_last_run_timestamp",
  help: "Unix timestamp in seconds for the last score reconciliation run.",
  registers: [metricsRegistry],
});

export const httpRequestDurationHistogram = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds.",
  labelNames: ["route", "status_code"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [metricsRegistry],
});

function routeLabel(req: Request): string {
  const routePath = req.route?.path;
  if (typeof routePath === "string") {
    return `${req.baseUrl}${routePath}` || req.path;
  }

  if (Array.isArray(routePath)) {
    return `${req.baseUrl}${routePath.join("|")}`;
  }

  return "unmatched";
}

export function metricsMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const endTimer = httpRequestDurationHistogram.startTimer();

  res.on("finish", () => {
    endTimer({
      route: routeLabel(req),
      status_code: String(res.statusCode),
    });
  });

  next();
}

export function recordIndexerLedgers(
  lastLedger: number,
  chainTip: number,
): void {
  indexerLastLedgerGauge.set(lastLedger);
  indexerChainTipGauge.set(chainTip);
  indexerLagLedgersGauge.set(Math.max(chainTip - lastLedger, 0));
}

export function recordScoreReconciliationRun(date = new Date()): void {
  scoreReconciliationLastRunTimestampGauge.set(
    Math.floor(date.getTime() / 1000),
  );
}

export async function refreshWebhookRetryQueueDepth(): Promise<void> {
  try {
    const result = await query(
      `SELECT COUNT(*)::int AS count
       FROM webhook_deliveries
       WHERE delivered_at IS NULL
         AND next_retry_at IS NOT NULL`,
      [],
    );
    webhookRetryQueueDepthGauge.set(Number(result.rows[0]?.count ?? 0));
  } catch (error) {
    logger.warn("Failed to refresh webhook retry queue depth metric", {
      error,
    });
  }
}

export async function metricsHandler(
  _req: Request,
  res: Response,
): Promise<void> {
  res.set("Content-Type", metricsRegistry.contentType);
  res.send(await metricsRegistry.metrics());
}
