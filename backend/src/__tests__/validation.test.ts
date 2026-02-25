import request from "supertest";
import app from "../app.js";

describe("Input Validation", () => {
  describe("POST /api/simulate", () => {
    it("should accept valid input", async () => {
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
      const response = await request(app).post("/api/simulate").send({
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
