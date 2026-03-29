import { EventIndexer } from "./eventIndexer.js";
import logger from "../utils/logger.js";

let activeIndexers: EventIndexer[] = [];

/**
 * Initialize and start the event indexers
 */
export const startIndexer = (): void => {
  if (activeIndexers.length > 0) {
    logger.warn("Indexers already running");
    return;
  }

  const rpcUrl =
    process.env.STELLAR_RPC_URL || "https://soroban-testnet.stellar.org";
  const pollIntervalMs = parseInt(
    process.env.INDEXER_POLL_INTERVAL_MS || "30000",
  );
  const batchSize = parseInt(process.env.INDEXER_BATCH_SIZE || "100");

  const contracts = [
    {
      name: "loan_manager",
      id: process.env.LOAN_MANAGER_CONTRACT_ID,
    },
    {
      name: "lending_pool",
      id: process.env.LENDING_POOL_CONTRACT_ID,
    },
    {
      name: "remittance_nft",
      id: process.env.REMITTANCE_NFT_CONTRACT_ID,
    },
  ];

  for (const contract of contracts) {
    if (!contract.id) {
      logger.warn(
        `${contract.name.toUpperCase()}_CONTRACT_ID not set, skipping indexer for ${contract.name}.`,
      );
      continue;
    }

    const indexer = new EventIndexer({
      name: contract.name,
      rpcUrl,
      contractId: contract.id,
      pollIntervalMs,
      batchSize,
    });

    indexer.start().catch((error) => {
      logger.error(`Failed to start indexer for ${contract.name}`, { error });
    });

    activeIndexers.push(indexer);
    logger.info(`Event indexer for ${contract.name} initialized`, {
      rpcUrl,
      contractId: contract.id,
      pollIntervalMs,
      batchSize,
    });
  }
};

/**
 * Stop all event indexers
 */
export const stopIndexer = (): void => {
  if (activeIndexers.length > 0) {
    for (const indexer of activeIndexers) {
      indexer.stop();
    }
    activeIndexers = [];
    logger.info("All event indexers stopped");
  }
};

/**
 * Get active indexers (for testing)
 */
export const getActiveIndexers = (): EventIndexer[] => {
  return activeIndexers;
};

/**
 * Get indexer instance (compatibility)
 */
export const getIndexer = (): EventIndexer | null => {
  return activeIndexers[0] || null;
};
