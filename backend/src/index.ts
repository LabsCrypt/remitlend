import dotenv from "dotenv";
dotenv.config();

// Sentry must be initialized before any other imports so it can instrument them
import { initSentry } from "./config/sentry.js";
initSentry();

import app from "./app.js";
import logger from "./utils/logger.js";
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

const port = process.env.PORT || 3001;

const server = app.listen(port, () => {
  logger.info(`Server is running on port ${port}`);

  // Start the event indexer
  startIndexer();

  // Start periodic on-chain default checks (if configured)
  startDefaultCheckerScheduler();

  // Start webhook retry processor
  startWebhookRetryProcessor();
});

const shutdown = (signal: "SIGTERM" | "SIGINT") => {
  logger.info(`${signal} signal received: closing HTTP server`);

  stopIndexer();
  stopDefaultCheckerScheduler();
  stopWebhookRetryProcessor();
  eventStreamService.closeAllConnections("Server shutting down");

  server.close((err) => {
    if (err) {
      logger.error("HTTP server shutdown failed", { signal, err });
      process.exit(1);
      return;
    }

    process.exit(0);
  });
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
