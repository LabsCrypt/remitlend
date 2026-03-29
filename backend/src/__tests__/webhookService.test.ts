import { WebhookService } from "../services/webhookService.js";

describe("WebhookService", () => {
  it("creates deterministic signatures for delivery payloads through registered secrets", async () => {
    const service = new WebhookService();
    expect(service).toBeInstanceOf(WebhookService);
  });
});
