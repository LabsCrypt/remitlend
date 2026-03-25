import request from "supertest";
import { jest } from "@jest/globals";

// Setup mocks BEFORE importing the app or the module under test
const mockQuery = jest.fn();
jest.unstable_mockModule("../db/connection.js", () => ({
  query: mockQuery,
  getClient: jest.fn(),
  closePool: jest.fn(),
}));

// Use dynamic imports to ensure mocks are applied
const { query } = (await import("../db/connection.js")) as any;
const { default: app } = (await import("../app.js")) as any;

const mockedQuery = query as jest.MockedFunction<typeof query>;
const VALID_API_KEY = "test-internal-key";

beforeAll(() => {
  process.env.INTERNAL_API_KEY = VALID_API_KEY;
});

afterAll(() => {
  delete process.env.INTERNAL_API_KEY;
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// GET /api/score/:userId
// ---------------------------------------------------------------------------
describe("GET /api/score/:userId", () => {
  it("should return a score for a valid userId", async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ current_score: 750 }] });
    
    const response = await request(app).get("/api/score/user123");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.userId).toBe("user123");
    expect(response.body.score).toBe(750);
    expect(response.body.band).toBeDefined();
    expect(response.body.factors).toBeDefined();
  });

  it("should return the same score for the same userId", async () => {
    mockedQuery.mockResolvedValue({ rows: [{ current_score: 600 }] });
    
    const r1 = await request(app).get("/api/score/alice");
    const r2 = await request(app).get("/api/score/alice");

    expect(r1.body.score).toBe(r2.body.score);
  });

  it("should return 500 if user not found", async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    
    const response = await request(app).get("/api/score/newuser");

    expect(response.status).toBe(200);
    expect(response.body.score).toBe(500);
  });

  it("should return 404 for empty userId segment", async () => {
    const response = await request(app).get("/api/score/");

    expect(response.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /api/score/update
// ---------------------------------------------------------------------------
describe("POST /api/score/update", () => {
  describe("Access control", () => {
    it("should reject requests with no API key", async () => {
      const response = await request(app)
        .post("/api/score/update")
        .send({ userId: "user123", repaymentAmount: 500, onTime: true });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    it("should reject requests with a wrong API key", async () => {
      const response = await request(app)
        .post("/api/score/update")
        .set("x-api-key", "wrong-key")
        .send({ userId: "user123", repaymentAmount: 500, onTime: true });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });

  describe("Successful updates", () => {
    it("should increase score by 15 for on-time repayment", async () => {
      // Mock old score fetch
      mockedQuery.mockResolvedValueOnce({ rows: [{ current_score: 500 }] });
      // Mock UPSERT returning new score
      mockedQuery.mockResolvedValueOnce({ rows: [{ current_score: 515 }] });

      const response = await request(app)
        .post("/api/score/update")
        .set("x-api-key", VALID_API_KEY)
        .send({ userId: "user123", repaymentAmount: 500, onTime: true });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.delta).toBe(15);
      expect(response.body.oldScore).toBe(500);
      expect(response.body.newScore).toBe(515);
      expect(response.body.band).toBeDefined();
    });

    it("should decrease score by 30 for a late repayment", async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [{ current_score: 500 }] });
      mockedQuery.mockResolvedValueOnce({ rows: [{ current_score: 470 }] });

      const response = await request(app)
        .post("/api/score/update")
        .set("x-api-key", VALID_API_KEY)
        .send({ userId: "user123", repaymentAmount: 300, onTime: false });

      expect(response.status).toBe(200);
      expect(response.body.delta).toBe(-30);
      expect(response.body.newScore).toBe(470);
    });

    it("should clamp newScore to 850 maximum", async () => {
      // 'max-score-user' hashes to a score near 850; delta +15 should clamp
      mockedQuery.mockResolvedValueOnce({ rows: [{ current_score: 840 }] }); // Old score
      mockedQuery.mockResolvedValueOnce({ rows: [{ current_score: 850 }] }); // New score (clamped)

      const response = await request(app)
        .post("/api/score/update")
        .set("x-api-key", VALID_API_KEY)
        .send({ userId: "user123", repaymentAmount: 100, onTime: true });

      expect(response.body.newScore).toBe(850);
    });

    it("should return userId and repaymentAmount in the response", async () => {
      mockedQuery.mockResolvedValueOnce({ rows: [] }); // Old score 500
      mockedQuery.mockResolvedValueOnce({ rows: [{ current_score: 515 }] });

      const response = await request(app)
        .post("/api/score/update")
        .set("x-api-key", VALID_API_KEY)
        .send({ userId: "alice", repaymentAmount: 750, onTime: true });

      expect(response.body.userId).toBe("alice");
      expect(response.body.repaymentAmount).toBe(750);
    });
  });

  describe("Validation errors", () => {
    it("should reject negative repaymentAmount", async () => {
      const response = await request(app)
        .post("/api/score/update")
        .set("x-api-key", VALID_API_KEY)
        .send({ userId: "user123", repaymentAmount: -100, onTime: true });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.errors).toBeDefined();
    });

    it("should reject missing onTime field", async () => {
      const response = await request(app)
        .post("/api/score/update")
        .set("x-api-key", VALID_API_KEY)
        .send({ userId: "user123", repaymentAmount: 500 });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it("should reject non-boolean onTime value", async () => {
      const response = await request(app)
        .post("/api/score/update")
        .set("x-api-key", VALID_API_KEY)
        .send({ userId: "user123", repaymentAmount: 500, onTime: "yes" });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it("should reject missing userId", async () => {
      const response = await request(app)
        .post("/api/score/update")
        .set("x-api-key", VALID_API_KEY)
        .send({ repaymentAmount: 500, onTime: true });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it("should reject repaymentAmount exceeding maximum", async () => {
      const response = await request(app)
        .post("/api/score/update")
        .set("x-api-key", VALID_API_KEY)
        .send({ userId: "user123", repaymentAmount: 2_000_000, onTime: true });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });
});
