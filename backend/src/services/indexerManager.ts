import { EventIndexer } from "./eventIndexer.js";
import logger from "../utils/logger.js";

let indexerInstance: EventIndexer | null = null;

/**
 * Initialize and start the event indexer
 */
export const startIndexer = (): void => {
  if (indexerInstance) {
    logger.warn("Indexer already running");
    return;
  }

  const rpcUrl =
    process.env.STELLAR_RPC_URL || "https://soroban-testnet.stellar.org";
  const contractId = process.env.LOAN_MANAGER_CONTRACT_ID;
  const pollIntervalMs = parseInt(
    process.env.INDEXER_POLL_INTERVAL_MS || "30000",
  );
  const batchSize = parseInt(process.env.INDEXER_BATCH_SIZE || "100");

  if (!contractId) {
    logger.warn(
      "LOAN_MANAGER_CONTRACT_ID not set, indexer will not start. Set this environment variable to enable event indexing.",
    );
    return;
  }

  indexerInstance = new EventIndexer({
    rpcUrl,
    contractId,
    pollIntervalMs,
    batchSize,
  });

  indexerInstance.start().catch((error) => {
    logger.error("Failed to start indexer", { error });
  });

  logger.info("Event indexer initialized", {
    rpcUrl,
    contractId,
    pollIntervalMs,
    batchSize,
  });
};

/**
 * Stop the event indexer
 */
export const stopIndexer = (): void => {
  if (indexerInstance) {
    indexerInstance.stop();
    indexerInstance = null;
    logger.info("Event indexer stopped");
  }
};

/**
 * Get indexer instance (for testing)
 */
export const getIndexer = (): EventIndexer | null => {
  return indexerInstance;
};
