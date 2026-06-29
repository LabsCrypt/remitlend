import dotenv from 'dotenv';
dotenv.config();

import { validateEnvVars } from './config/env.js';
validateEnvVars();

// Sentry must be initialized before any other imports so it can instrument them
import { initSentry } from './config/sentry.js';
initSentry();

const app = (await import('./app.js')).default;
import logger from './utils/logger.js';
import { closePool } from './db/connection.js';
import { startIndexer, stopIndexer } from './services/indexerManager.js';
import {
  startDefaultCheckerScheduler,
  stopDefaultCheckerScheduler,
} from './services/defaultChecker.js';
import {
  startWebhookRetryProcessor,
  stopWebhookRetryProcessor,
} from './services/webhookRetryProcessor.js';
import { eventStreamService } from './services/eventStreamService.js';
import {
  startNotificationCleanupScheduler,
  stopNotificationCleanupScheduler,
} from './services/notificationService.js';
import {
  startScoreReconciliationScheduler,
  stopScoreReconciliationScheduler,
} from "./services/scoreReconciliationService.js";
import { sorobanService } from "./services/sorobanService.js";
import { validateLoanConfig } from "./config/loanConfig.js";
import { startLoanDueCheckCron } from "./cron/loanCheckCron.js";
// Imported the score decay scheduler initialization wrapper
import { startScoreDecayScheduler } from "./cron/scoreDecayJob.js";

const port = process.env.PORT || 3001;

// Maintain a mutable handle to invoke clean scheduler closures on process stops
let scoreDecaySchedulerHandle: { stop: () => void } | null = null;

// Validate score delta and loan config on startup before accepting traffic
try {
  validateLoanConfig();
  sorobanService.validateScoreConfig();
} catch (err) {
  logger.error('Startup configuration is invalid, aborting startup.', { err });
  process.exit(1);
}

// Validate Soroban contract IDs and RPC connectivity before accepting traffic
try {
  await sorobanService.validateConfig();
} catch (err) {
  logger.error('Soroban configuration is invalid, aborting startup.', { err });
  process.exit(1);
}

const server = app.listen(port, () => {
  logger.info(`Server is running on port ${port}`);

  // Start the event indexer
  startIndexer();

  // Start periodic on-chain default checks (if configured)
  startDefaultCheckerScheduler();

  // Start webhook retry processor (5m/15m/45m backoff via WebhookService.processRetries)
  startWebhookRetryProcessor();

  // Start scheduled score reconciliation against on-chain state
  startScoreReconciliationScheduler();

  // Start periodic notification cleanup
  startNotificationCleanupScheduler();

  // Start loan due check cron
  startLoanDueCheckCron();

  // Wire up and activate the score decay daily scheduler loop
  scoreDecaySchedulerHandle = startScoreDecayScheduler() || null;
});

const shutdown = async (signal: 'SIGTERM' | 'SIGINT') => {
  logger.info(`${signal} signal received: closing HTTP server`);

  // Timeout (30s) force-kills if shutdown stalls
  const timeout = setTimeout(() => {
    logger.error('Shutdown stalled for 30s, forcing exit.');
    process.exit(1);
  }, 30000);
  timeout.unref();

  try {
    // Gracefully stop the score decay scheduler if it was active
    if (scoreDecaySchedulerHandle) {
      scoreDecaySchedulerHandle.stop();
    }

    await stopIndexer();
    stopDefaultCheckerScheduler();
    stopWebhookRetryProcessor();
    stopScoreReconciliationScheduler();
    stopNotificationCleanupScheduler();

    if (
      typeof (eventStreamService as unknown as { closeAll: (reason: string) => void }).closeAll ===
      'function'
    ) {
      (eventStreamService as unknown as { closeAll: (reason: string) => void }).closeAll(
        'Server shutting down',
      );
    } else if (typeof eventStreamService.closeAllConnections === 'function') {
      eventStreamService.closeAllConnections('Server shutting down');
    }

    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });

    await closePool();
    logger.info('Database pool drained.');
    process.exit(0);
  } catch (err) {
    logger.error('Graceful shutdown failed', { signal, err });
    process.exit(1);
  }
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
