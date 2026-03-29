import request from "supertest";
import app from "../app.js";

describe("Centralized Error Handling", () => {
  /* ── 404 Not Found ────────────────────────────────────────── */

  describe("404 catch-all", () => {
    it("should return 404 with structured JSON including error code", async () => {
      const response = await request(app).get("/nonexistent-route");

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      // Legacy format
      expect(response.body.message).toMatch(/Cannot GET \/nonexistent-route/);
      // New structured format
      expect(response.body.error).toBeDefined();
      expect(response.body.error.code).toBe("NOT_FOUND");
      expect(response.body.error.message).toMatch(/Cannot GET \/nonexistent-route/);
    });

    it("should return 404 for unknown POST routes with error code", async () => {
      const response = await request(app)
        .post("/unknown")
        .send({ data: "test" });

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe("NOT_FOUND");
    });
  });

  /* ── Validation Errors (backward compatibility) ───────────── */

  describe("Zod validation errors", () => {
    it("should return 400 with validation failed message and error code", async () => {
      const response = await request(app).post("/api/simulate").send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      // Legacy format
      expect(response.body.message).toBe("Validation failed");
      expect(response.body.errors).toBeDefined();
      // New structured format
      expect(response.body.error).toBeDefined();
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      expect(response.body.error.message).toBe("Validation failed");
      expect(response.body.error.details).toBeDefined();
      expect(Array.isArray(response.body.error.details)).toBe(true);
    });

    it("should include field and message in each validation error detail", async () => {
      const response = await request(app)
        .post("/api/simulate")
        .send({ userId: "user1" });

      expect(response.status).toBe(400);
      // Legacy format
      expect(response.body.errors.length).toBeGreaterThan(0);
      expect(response.body.errors[0]).toHaveProperty("path");
      expect(response.body.errors[0]).toHaveProperty("message");
      // New structured format
      expect(response.body.error.details.length).toBeGreaterThan(0);
      expect(response.body.error.details[0]).toHaveProperty("field");
      expect(response.body.error.details[0]).toHaveProperty("message");
    });
  });

  /* ── Consistent JSON structure ────────────────────────────── */

  describe("Response structure consistency", () => {
    it("should always include success and error fields in error responses", async () => {
      const response = await request(app).get("/does-not-exist");

      expect(response.body).toHaveProperty("success", false);
      // Legacy format
      expect(response.body).toHaveProperty("message");
      // New structured format
      expect(response.body).toHaveProperty("error");
      expect(response.body.error).toHaveProperty("code");
      expect(response.body.error).toHaveProperty("message");
    });

    it("should not expose stack traces in production-like responses", async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";

      const response = await request(app).get("/does-not-exist");

      expect(response.body.error).not.toHaveProperty("stack");

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
    it("should handle operational AppErrors (400 Bad Request) with error code", async () => {
      const response = await request(app).get("/test/error/operational");

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      // Legacy format
      expect(response.body.message).toBe("Diagnostic operational error");
      // New structured format
      expect(response.body.error.message).toBe("Diagnostic operational error");
      expect(response.body.error.code).toBeDefined();
    });

    it("should handle internal AppErrors (500 Internal Server Error) with error code", async () => {
      const response = await request(app).get("/test/error/internal");

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      // Legacy format
      expect(response.body.message).toBe("Internal server error");
      // New structured format
      expect(response.body.error.message).toBe("Internal server error");
      expect(response.body.error.code).toBe("INTERNAL_ERROR");
    });

    it("should handle unexpected exceptions (500 Internal Server Error) with error code", async () => {
      const response = await request(app).get("/test/error/unexpected");

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      // Legacy format
      expect(response.body.message).toBe("Internal server error");
      // New structured format
      expect(response.body.error.message).toBe("Internal server error");
      expect(response.body.error.code).toBe("INTERNAL_ERROR");
    });

    it("should catch async exceptions via asyncHandler middleware with error code", async () => {
      const response = await request(app).get("/test/error/async");

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      // Legacy format
      expect(response.body.message).toBe("Internal server error");
      // New structured format
      expect(response.body.error.message).toBe("Internal server error");
      expect(response.body.error.code).toBe("INTERNAL_ERROR");
    });
  });

  /* ── Authentication Error Codes ───────────────────────────── */

  describe("Authentication error codes", () => {
    it("should return VALIDATION_ERROR error code for missing public key (Zod validation)", async () => {
      // Zod validation runs before controller logic
      const response = await request(app)
        .post("/api/auth/challenge")
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      expect(response.body.error.details[0]?.field).toBe("publicKey");
    });

    it("should return INVALID_PUBLIC_KEY error code for invalid key format", async () => {
      // Controller logic runs after Zod validation passes
      const response = await request(app)
        .post("/api/auth/challenge")
        .send({ publicKey: "invalid" });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("INVALID_PUBLIC_KEY");
      expect(response.body.error.field).toBe("publicKey");
    });

    it("should return VALIDATION_ERROR error code for missing signature in login (Zod validation)", async () => {
      // Zod validation runs before controller logic
      const response = await request(app)
        .post("/api/auth/login")
        .send({ publicKey: "GXXX", message: "test" });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      expect(response.body.error.details[0]?.field).toBe("signature");
    });
  });
});
