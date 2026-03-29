import request from "supertest";
import app from "../app.js";

describe("Request ID middleware", () => {
  it("adds x-request-id when missing", async () => {
    const response = await request(app).get("/");
    const requestId = response.headers["x-request-id"] as string | undefined;

    expect(response.status).toBe(200);
    expect(requestId).toBeDefined();
    expect(typeof requestId).toBe("string");
    expect((requestId ?? "").length).toBeGreaterThan(0);
  });

  it("preserves client x-request-id", async () => {
    const requestId = "test-request-id-123";

    const response = await request(app).get("/").set("x-request-id", requestId);

    expect(response.status).toBe(200);
    expect(response.headers["x-request-id"]).toBe(requestId);
  });
});
