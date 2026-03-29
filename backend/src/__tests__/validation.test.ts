import request from "supertest";
import { jest } from "@jest/globals";

// Setup mocks BEFORE importing the app
const mockQuery = jest.fn();
jest.unstable_mockModule("../db/connection.js", () => ({
  default: { query: mockQuery },
  query: mockQuery,
  getClient: jest.fn(),
  closePool: jest.fn(),
}));

// Use dynamic imports to ensure mocks are applied
await import("../db/connection.js");
const { default: app } = await import("../app.js");

describe("Input Validation", () => {
  describe("POST /api/simulate", () => {
    it("should accept valid input", async () => {
      // Mock score fetch
      (mockQuery as any).mockResolvedValueOnce({
        rows: [{ current_score: 500 }],
      });

      const response = await request(app).post("/api/simulate").send({
        userId: "user123",
        amount: 500,
      });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it("should reject missing userId", async () => {
      const response = await request(app).post("/api/simulate").send({
        amount: 500,
      });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe("Validation failed");
    });

    it("should reject missing amount", async () => {
      const response = await request(app).post("/api/simulate").send({
        userId: "user123",
      });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it("should reject negative amount", async () => {
      const response = await request(app).post("/api/simulate").send({
        userId: "user123",
        amount: -100,
      });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.errors).toBeDefined();
    });

    it("should reject amount exceeding maximum", async () => {
      const response = await request(app).post("/api/simulate").send({
        userId: "user123",
        amount: 2000000,
      });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it("should reject zero amount", async () => {
      const response = await request(app).post("/api/simulate").send({
        userId: "user123",
        amount: 0,
      });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it("should reject empty userId", async () => {
      const response = await request(app).post("/api/simulate").send({
        userId: "",
        amount: 500,
      });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it("should reject userId that is too long", async () => {
      const response = await request(app)
        .post("/api/simulate")
        .send({
          userId: "a".repeat(101),
          amount: 500,
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it("should reject non-numeric amount", async () => {
      const response = await request(app).post("/api/simulate").send({
        userId: "user123",
        amount: "five hundred",
      });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe("GET /api/history/:userId", () => {
    it("should accept valid userId", async () => {
      // Mock score fetch and events fetch
      (mockQuery as any)
        .mockResolvedValueOnce({ rows: [{ current_score: 500 }] }) // score
        .mockResolvedValueOnce({ rows: [] }); // events

      const response = await request(app).get("/api/history/user123");

      expect(response.status).toBe(200);
      expect(response.body.userId).toBe("user123");
    });

    it("should reject empty userId", async () => {
      const response = await request(app).get("/api/history/");

      expect(response.status).toBe(404);
    });
  });
});
