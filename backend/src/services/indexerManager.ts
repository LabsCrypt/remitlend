import { EventIndexer } from "./eventIndexer.js";
import logger from "../utils/logger.js";
import { getStellarRpcUrl } from "../config/stellar.js";

let indexerInstance: EventIndexer | null = null;

/**
 * Initialize and start the event indexer
 */
export const startIndexer = (): void => {
  if (indexerInstance) {
    logger.warn("Indexer already running");
    return;
  }

  const contractIds = [
    process.env.LOAN_MANAGER_CONTRACT_ID,
    process.env.LENDING_POOL_CONTRACT_ID,
    process.env.REMITTANCE_NFT_CONTRACT_ID,
    process.env.GOVERNANCE_CONTRACT_ID,
  ].filter((id): id is string => Boolean(id && id.trim().length > 0));
  const pollIntervalMs = parseInt(
    process.env.INDEXER_POLL_INTERVAL_MS || "30000",
  );
  const batchSize = parseInt(process.env.INDEXER_BATCH_SIZE || "100");

  if (contractIds.length === 0) {
    logger.warn(
      "No contract IDs set for indexer. Set LOAN_MANAGER_CONTRACT_ID, LENDING_POOL_CONTRACT_ID, or REMITTANCE_NFT_CONTRACT_ID.",
    );
    return;
  }

  const rpcUrl = getStellarRpcUrl();

  indexerInstance = new EventIndexer({
    rpcUrl,
    contractConfigs: contractIds.map((contractId) => ({ contractId })),
    pollIntervalMs,
    batchSize,
  });

  indexerInstance.start().catch((error) => {
    logger.error("Failed to start indexer", { error });
  });

  logger.info("Event indexer initialized", {
    rpcUrl,
    contractIds,
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
