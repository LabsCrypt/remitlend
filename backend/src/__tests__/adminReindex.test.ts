import request from "supertest";
import app from "../app.js";

describe("Admin reindex endpoint", () => {
  const apiKey = "test-internal-api-key";

  beforeAll(() => {
    process.env.INTERNAL_API_KEY = apiKey;
  });

  it("rejects requests without API key", async () => {
    const response = await request(app).post(
      "/api/admin/reindex?fromLedger=1&toLedger=2",
    );

    expect(response.status).toBe(401);
  });

  it("validates ledger range query parameters", async () => {
    const response = await request(app)
      .post("/api/admin/reindex?fromLedger=abc&toLedger=2")
      .set("x-api-key", apiKey);

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });
});
