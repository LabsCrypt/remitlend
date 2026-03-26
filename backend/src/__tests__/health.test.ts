import request from "supertest";
import app from "../app.js";

describe("GET /health", () => {
  it("should return 200 or 503 with a status field", async () => {
    const response = await request(app).get("/health");

    expect([200, 503]).toContain(response.status);
    expect(["ok", "degraded"]).toContain(response.body.status);
  });

  it("should always report api check as ok", async () => {
    const response = await request(app).get("/health");

    expect(response.body).toHaveProperty("checks");
    expect(response.body.checks.api).toBe("ok");
  });

  it("should return uptime as a number", async () => {
    const response = await request(app).get("/health");

    expect(response.body).toHaveProperty("uptime");
    expect(typeof response.body.uptime).toBe("number");
  });

  it("should return timestamp as a number", async () => {
    const response = await request(app).get("/health");

    expect(response.body).toHaveProperty("timestamp");
    expect(typeof response.body.timestamp).toBe("number");
  });
});
