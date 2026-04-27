import dotenv from "dotenv";
dotenv.config();

import { validateEnvVars } from "./config/env.js";
validateEnvVars();

// Sentry must be initialized before any other imports so it can instrument them
import { initSentry } from "./config/sentry.js";
initSentry();

const app = (await import("./app.js")).default;
import logger from "./utils/logger.js";
import pool from "./db/connection.js";
import { startIndexer, stopIndexer } from "./services/indexerManager.js";
import {
  startDefaultCheckerScheduler,
  stopDefaultCheckerScheduler,
} from "./services/defaultChecker.js";
import {
  startWebhookRetryScheduler,
  stopWebhookRetryScheduler,
} from "./services/webhookRetryScheduler.js";
import { eventStreamService } from "./services/eventStreamService.js";
import {
  startNotificationCleanupScheduler,
  stopNotificationCleanupScheduler,
} from "./services/notificationService.js";
import {
  startScoreReconciliationScheduler,
  stopScoreReconciliationScheduler,
} from "./services/scoreReconciliationService.js";
import { sorobanService } from "./services/sorobanService.js";
import { validateLoanConfig } from "./config/loanConfig.js";
import { startLoanDueCheckCron } from "./cron/loanCheckCron.js";

const port = process.env.PORT || 3001;

// Validate score delta and loan config on startup before accepting traffic
try {
  validateLoanConfig();
  sorobanService.validateScoreConfig();
} catch (err) {
  logger.error("Startup configuration is invalid, aborting startup.", { err });
  process.exit(1);
}

// Validate Soroban contract IDs and RPC connectivity before accepting traffic
try {
  await sorobanService.validateConfig();
} catch (err) {
  logger.error("Soroban configuration is invalid, aborting startup.", { err });
  process.exit(1);
}

const server = app.listen(port, () => {
  logger.info(`Server is running on port ${port}`);

  // Start the event indexer
  startIndexer();

  // Start periodic on-chain default checks (if configured)
  startDefaultCheckerScheduler();

  // Start webhook retry scheduler
  startWebhookRetryScheduler();

  // Start scheduled score reconciliation against on-chain state
  startScoreReconciliationScheduler();

  // Start periodic notification cleanup
  startNotificationCleanupScheduler();

  // Start loan due check cron
  startLoanDueCheckCron();
});

const shutdown = async (signal: "SIGTERM" | "SIGINT") => {
  logger.info(`${signal} signal received: closing HTTP server`);

  // Timeout (30s) force-kills if shutdown stalls
  const timeout = setTimeout(() => {
    logger.error("Shutdown stalled for 30s, forcing exit.");
    process.exit(1);
  }, 30000);
  timeout.unref();

  stopIndexer();
  stopDefaultCheckerScheduler();
  stopWebhookRetryScheduler();
  stopScoreReconciliationScheduler();
  stopNotificationCleanupScheduler();

  const svc = eventStreamService as unknown as Record<string, unknown>;
  if (typeof svc["closeAll"] === "function") {
    (svc["closeAll"] as (msg: string) => void)("Server shutting down");
  } else if (
    typeof (eventStreamService as any).closeAllConnections === "function"
  ) {
    (eventStreamService as any).closeAllConnections("Server shutting down");
  }

  server.close(async (err) => {
    if (err) {
      logger.error("HTTP server shutdown failed", { signal, err });
      process.exit(1);
      return;
    }

    try {
      const p = pool as unknown as Record<string, unknown>;
      if (pool && typeof p["drain"] === "function") {
        await (p["drain"] as () => Promise<void>)();
        logger.info("Database pool drained.");
      } else if (pool && typeof p["end"] === "function") {
        await (p["end"] as () => Promise<void>)();
        logger.info("Database pool ended.");
      }
    } catch (e) {
      logger.error("Failed to drain DB pool", e);
    }

    process.exit(0);
  });
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
