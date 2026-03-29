import request from "supertest";
import app from "../app.js";

describe("Centralized Error Handling", () => {
  /* ── 404 Not Found ────────────────────────────────────────── */

  describe("404 catch-all", () => {
    it("should return 404 with structured JSON for unknown routes", async () => {
      const response = await request(app).get("/nonexistent-route");

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toMatch(/Cannot GET \/nonexistent-route/);
    });

    it("should return 404 for unknown POST routes", async () => {
      const response = await request(app)
        .post("/unknown")
        .send({ data: "test" });

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });
  });

  /* ── Validation Errors (backward compatibility) ───────────── */

  describe("Zod validation errors", () => {
    it("should return 400 with validation failed message", async () => {
      const response = await request(app).post("/api/simulate").send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe("Validation failed");
      expect(response.body.errors).toBeDefined();
      expect(Array.isArray(response.body.errors)).toBe(true);
    });

    it("should include path and message in each error entry", async () => {
      const response = await request(app)
        .post("/api/simulate")
        .send({ userId: "user1" });

      expect(response.status).toBe(400);
      expect(response.body.errors.length).toBeGreaterThan(0);
      expect(response.body.errors[0]).toHaveProperty("path");
      expect(response.body.errors[0]).toHaveProperty("message");
    });
  });

  /* ── Consistent JSON structure ────────────────────────────── */

  describe("Response structure consistency", () => {
    it("should always include success field in error responses", async () => {
      const response = await request(app).get("/does-not-exist");

      expect(response.body).toHaveProperty("success", false);
      expect(response.body).toHaveProperty("message");
    });

    it("should not expose stack traces in production-like responses", async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";

      const response = await request(app).get("/does-not-exist");

      expect(response.body).not.toHaveProperty("stack");

      process.env.NODE_ENV = originalEnv;
    });

    it("should expose stack traces only with explicit development opt-in", async () => {
      const originalEnv = process.env.NODE_ENV;
      const originalExposeStackTraces = process.env.EXPOSE_STACK_TRACES;

      process.env.NODE_ENV = "development";
      process.env.EXPOSE_STACK_TRACES = "true";
      const developmentResponse = await request(app).get("/test/error/unexpected");

      expect(developmentResponse.status).toBe(500);
      expect(developmentResponse.body).toHaveProperty("stack");

      process.env.NODE_ENV = "development";
      process.env.EXPOSE_STACK_TRACES = "false";
      const noOptInResponse = await request(app).get("/test/error/unexpected");

      expect(noOptInResponse.status).toBe(500);
      expect(noOptInResponse.body).not.toHaveProperty("stack");

      process.env.NODE_ENV = "staging";
      process.env.EXPOSE_STACK_TRACES = "true";
      const stagingResponse = await request(app).get("/test/error/unexpected");

      expect(stagingResponse.status).toBe(500);
      expect(stagingResponse.body).not.toHaveProperty("stack");

      if (originalEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalEnv;
      }

      if (originalExposeStackTraces === undefined) {
        delete process.env.EXPOSE_STACK_TRACES;
      } else {
        process.env.EXPOSE_STACK_TRACES = originalExposeStackTraces;
      }
    });
  });

  /* ── Diagnostic Routes (Integration) ───────────────────────── */

  describe("Specific error scenarios (Diagnostic)", () => {
    it("should handle operational AppErrors (400 Bad Request)", async () => {
      const response = await request(app).get("/test/error/operational");

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe("Diagnostic operational error");
    });

    it("should handle internal AppErrors (500 Internal Server Error)", async () => {
      const response = await request(app).get("/test/error/internal");

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe("Internal server error"); // User-friendly message
    });

    it("should handle unexpected exceptions (500 Internal Server Error)", async () => {
      const response = await request(app).get("/test/error/unexpected");

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe("Internal server error");
    });

    it("should catch async exceptions via asyncHandler middleware", async () => {
      const response = await request(app).get("/test/error/async");

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe("Internal server error");
    });
  });
});
