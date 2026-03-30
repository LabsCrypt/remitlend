import dotenv from "dotenv";
dotenv.config();

import { validateEnvVars } from "./config/env.js";
validateEnvVars();

// Sentry must be initialized before any other imports so it can instrument them
import { initSentry } from "./config/sentry.js";
initSentry();

import app from "./app.js";
import logger from "./utils/logger.js";
import pool from "./db/connection.js";
import { startIndexer, stopIndexer } from "./services/indexerManager.js";
import {
  startDefaultCheckerScheduler,
  stopDefaultCheckerScheduler,
} from "./services/defaultChecker.js";
import {
  startWebhookRetryProcessor,
  stopWebhookRetryProcessor,
} from "./services/webhookRetryProcessor.js";
import { eventStreamService } from "./services/eventStreamService.js";
import {
  startNotificationCleanupScheduler,
  stopNotificationCleanupScheduler,
} from "./services/notificationService.js";
import { sorobanService } from "./services/sorobanService.js";
import { validateLoanConfig } from "./config/loanConfig.js";

const port = process.env.PORT || 3001;

// Validate loan config on startup before accepting traffic
try {
  validateLoanConfig();
} catch (err) {
  logger.error("Loan configuration is invalid, aborting startup.", { err });
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

  // Start webhook retry processor
  startWebhookRetryProcessor();
  
  // Start periodic notification cleanup
  startNotificationCleanupScheduler();
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
  stopNotificationCleanupScheduler();
  
  if (typeof (eventStreamService as any).closeAll === 'function') {
    (eventStreamService as any).closeAll("Server shutting down");
  } else if (typeof eventStreamService.closeAllConnections === 'function') {
    eventStreamService.closeAllConnections("Server shutting down");
  }

  server.close(async (err) => {
    if (err) {
      logger.error("HTTP server shutdown failed", { signal, err });
      process.exit(1);
      return;
    }

    try {
      if (pool && typeof (pool as any).drain === 'function') {
        await (pool as any).drain();
        logger.info("Database pool drained.");
      } else if (pool && typeof (pool as any).end === 'function') {
        await (pool as any).end();
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
