import request from "supertest";
import app from "../app.js";

describe("API Versioning", () => {
  describe("Legacy API routes (backward compatibility)", () => {
    it("should respond to /api/score endpoint", async () => {
      const response = await request(app).get("/api/score/test-user");
      // Should return 401 for missing auth, not 404 for missing route
      expect(response.status).not.toBe(404);
    });

    it("should respond to /api/loans endpoint", async () => {
      const response = await request(app).get("/api/loans/borrower/test-user");
      // Should return 401 for missing auth, not 404 for missing route
      expect(response.status).not.toBe(404);
    });

    it("should respond to /api/docs endpoint", async () => {
      const response = await request(app).get("/api/docs");
      expect(response.status).toBe(200);
    });
  });

  describe("Versioned API routes (v1)", () => {
    it("should respond to /api/v1/score endpoint", async () => {
      const response = await request(app).get("/api/v1/score/test-user");
      // Should return 401 for missing auth, not 404 for missing route
      expect(response.status).not.toBe(404);
    });

    it("should respond to /api/v1/loans endpoint", async () => {
      const response = await request(app).get("/api/v1/loans/borrower/test-user");
      // Should return 401 for missing auth, not 404 for missing route
      expect(response.status).not.toBe(404);
    });

    it("should respond to /api/v1/docs endpoint", async () => {
      const response = await request(app).get("/api/v1/docs");
      expect(response.status).toBe(200);
    });
  });

  describe("Non-existent routes", () => {
    it("should return 404 for non-existent versioned routes", async () => {
      const response = await request(app).get("/api/v2/score/test-user");
      expect(response.status).toBe(404);
    });

    it("should return 404 for completely non-existent routes", async () => {
      const response = await request(app).get("/api/nonexistent");
      expect(response.status).toBe(404);
    });
  });
});
