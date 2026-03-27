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
import { NotificationSchedulerService } from "./services/notificationSchedulerService.js";

const port = process.env.PORT || 3001;

// Initialize notification scheduler
const notificationScheduler = NotificationSchedulerService.getInstance();

app.listen(port, () => {
  logger.info(`Server is running on port ${port}`);

  // Start the event indexer
  startIndexer();

  // Start periodic on-chain default checks (if configured)
  startDefaultCheckerScheduler();

  // Start notification scheduler
  notificationScheduler.start();
});

// Graceful shutdown
process.on("SIGTERM", () => {
  logger.info("SIGTERM signal received: closing HTTP server");
  stopIndexer();
  stopDefaultCheckerScheduler();
  notificationScheduler.stop();
  process.exit(0);
});

process.on("SIGINT", () => {
  logger.info("SIGINT signal received: closing HTTP server");
  stopIndexer();
  stopDefaultCheckerScheduler();
  notificationScheduler.stop();
  process.exit(0);
});
