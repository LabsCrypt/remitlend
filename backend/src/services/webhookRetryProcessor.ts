import logger from "../utils/logger.js";
import { refreshWebhookRetryQueueDepth } from "../middleware/metrics.js";
import { WebhookService } from "./webhookService.js";
import { jobMetricsService } from "./jobMetricsService.js";

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
    const startTime = Date.now();
    const jobName = "webhookRetryProcessor";

    try {
      await refreshWebhookRetryQueueDepth();
      await WebhookService.processRetries();
      await refreshWebhookRetryQueueDepth();

      const durationMs = Date.now() - startTime;
      jobMetricsService.recordSuccess(jobName, durationMs);
    } catch (error) {
      const durationMs = Date.now() - startTime;
      jobMetricsService.recordFailure(
        jobName,
        error as Error | string,
        durationMs,
      );
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
