import { jest } from '@jest/globals';
import * as db from "../db/connection.js";
import { WebhookService, getRetryDelayMs } from "../services/webhookService.js";

describe("WebhookService", () => {
  it("returns the expected retry delays", () => {
    expect(getRetryDelayMs(1)).toBe(30 * 1000);
    expect(getRetryDelayMs(2)).toBe(2 * 60 * 1000);
    expect(getRetryDelayMs(3)).toBe(10 * 60 * 1000);
    expect(getRetryDelayMs(4)).toBe(10 * 60 * 1000); // capped at last delay
  });

  // Note: processRetries depends on DB access. We cover the retry schedule math here.
  // For full integration, the app should enable webhooks and DB for E2E tests.

});
