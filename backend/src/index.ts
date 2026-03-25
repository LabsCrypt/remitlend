import dotenv from "dotenv";
import app from "./app.js";
import logger from "./utils/logger.js";
import { startIndexer, stopIndexer } from "./services/indexerManager.js";
import { notificationScheduler } from "./services/notificationScheduler.js";

dotenv.config();

const port = process.env.PORT || 3001;

app.listen(port, () => {
  logger.info(`Server is running on port ${port}`);

  // Start the event indexer
  startIndexer();

  // Start the notification scheduler
  notificationScheduler.start();
});

// Graceful shutdown
process.on("SIGTERM", () => {
  logger.info("SIGTERM signal received: closing HTTP server");
  stopIndexer();
  notificationScheduler.stop();
  process.exit(0);
});

process.on("SIGINT", () => {
  logger.info("SIGINT signal received: closing HTTP server");
  stopIndexer();
  notificationScheduler.stop();
  process.exit(0);
});
