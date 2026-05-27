import logger from "../utils/logger.js";
import { refreshWebhookRetryQueueDepth } from "../middleware/metrics.js";
import { WebhookService } from "./webhookService.js";

let retryProcessorInterval: NodeJS.Timeout | null = null;

/**
 * Starts the webhook retry processor that periodically checks for failed
 * webhook deliveries and retries them with exponential backoff.
 *
 * Runs every 10 seconds to process pending retries.
 */
export function startWebhookRetryProcessor(): void {
  if (retryProcessorInterval) {
    logger.withContext().warn("Webhook retry processor already running");
    return;
  }

  logger.withContext().info("Starting webhook retry processor");

  // Run retry processor every 10 seconds
  retryProcessorInterval = setInterval(async () => {
    try {
      await refreshWebhookRetryQueueDepth();
      await WebhookService.processRetries();
      await refreshWebhookRetryQueueDepth();
    } catch (error) {
      logger
        .withContext()
        .error("Error in webhook retry processor interval", { error });
    }
  }, 10 * 1000);
}

/**
 * Stops the webhook retry processor.
 */
export function stopWebhookRetryProcessor(): void {
  if (retryProcessorInterval) {
    logger.withContext().info("Stopping webhook retry processor");
    clearInterval(retryProcessorInterval);
    retryProcessorInterval = null;
  }
}
