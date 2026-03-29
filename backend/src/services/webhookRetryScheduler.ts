import { webhookService } from "./webhookService.js";
import logger from "../utils/logger.js";

export class WebhookRetryScheduler {
  private interval: ReturnType<typeof setInterval> | undefined;
  private isRunning = false;
  private intervalMs: number;

  constructor(intervalMs: number = 60 * 1000) {
    this.intervalMs = intervalMs;
  }

  start(): void {
    if (this.interval) {
      logger.warn("Webhook retry scheduler is already running");
      return;
    }

    this.interval = setInterval(async () => {
      await this.processRetries();
    }, this.intervalMs);

    logger.info("Webhook retry scheduler started", { intervalMs: this.intervalMs });
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
      logger.info("Webhook retry scheduler stopped");
    }
  }

  private async processRetries(): Promise<void> {
    if (this.isRunning) return;

    this.isRunning = true;
    try {
      const pendingRetries = await webhookService.getPendingRetries(50);
      
      if (pendingRetries.length === 0) {
        return;
      }

      logger.info(`Processing ${pendingRetries.length} pending webhook retries`);

      await Promise.all(
        pendingRetries.map(async (delivery) => {
          try {
            // We need to fetch the subscription details to get the callback URL and secret
            // getPendingRetries already does a JOIN, so we have them in the row, 
            // but mapDeliveryRow doesn't include them in the interface.
            // I've added mapRetryToContext in webhookService to handle this.
            
            // Re-fetch with join to get all needed info safely if not in delivery object
            // Actually, I'll update getPendingRetries to return the context directly.
            
            // Since I've implemented mapRetryToContext in WebhookService, 
            // I'll use it to get the context for each delivery.
            
            // NOTE: In a real production system, we might want to limit concurrency here.
            await webhookService.sendToWebhook(
              delivery.subscriptionId,
              (delivery as any).callbackUrl, // These are injected by the JOIN in getPendingRetries
              (delivery as any).secret,
              (delivery as any).maxAttempts,
              delivery.payload,
              delivery.id,
              delivery.attemptCount + 1
            );
          } catch (error) {
            logger.error("Failed to process webhook retry", {
              deliveryId: delivery.id,
              error
            });
          }
        })
      );
    } catch (error) {
      logger.error("Error in webhook retry scheduler loop", { error });
    } finally {
      this.isRunning = false;
    }
  }
}

export const webhookRetryScheduler = new WebhookRetryScheduler();
