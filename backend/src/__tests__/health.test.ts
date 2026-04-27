import request from "supertest";
import app from "../app.js";

describe("GET /health", () => {
  it("should return 200 with basic service info for monitoring", async () => {
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ok");
    expect(typeof response.body.uptime).toBe("number");
    expect(response.body.uptime).toBeGreaterThanOrEqual(0);
    expect(typeof response.body.timestamp).toBe("string");
    expect(Number.isNaN(Date.parse(response.body.timestamp))).toBe(false);
    expect(response.body).not.toHaveProperty("checks");
  });
});
