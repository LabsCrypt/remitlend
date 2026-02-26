import request from "supertest";
import app from "../app.js";
import { query } from "../db/connection.js";

describe("Indexer API", () => {
  describe("GET /api/indexer/status", () => {
    it("should return indexer status", async () => {
      const response = await request(app)
        .get("/api/indexer/status")
        .expect("Content-Type", /json/);

      expect(response.body).toHaveProperty("success");
      if (response.status === 200) {
        expect(response.body.data).toHaveProperty("lastIndexedLedger");
        expect(response.body.data).toHaveProperty("totalEvents");
        expect(response.body.data).toHaveProperty("eventsByType");
      }
    });
  });

  describe("GET /api/indexer/events/recent", () => {
    it("should return recent events", async () => {
      const response = await request(app)
        .get("/api/indexer/events/recent?limit=10")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body.data).toHaveProperty("events");
      expect(Array.isArray(response.body.data.events)).toBe(true);
    });

    it("should filter by event type", async () => {
      const response = await request(app)
        .get("/api/indexer/events/recent?eventType=LoanRequested")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body.data).toHaveProperty("events");

      // All events should be of the requested type
      response.body.data.events.forEach((event: { event_type: string }) => {
        expect(event.event_type).toBe("LoanRequested");
      });
    });
  });

  describe("GET /api/indexer/events/borrower/:borrower", () => {
    it("should return events for a specific borrower", async () => {
      const testBorrower =
        "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

      const response = await request(app)
        .get(`/api/indexer/events/borrower/${testBorrower}`)
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body.data).toHaveProperty("events");
      expect(response.body.data).toHaveProperty("pagination");
    });

    it("should support pagination", async () => {
      const testBorrower =
        "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

      const response = await request(app)
        .get(`/api/indexer/events/borrower/${testBorrower}?limit=5&offset=0`)
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body.data.pagination).toHaveProperty("limit", 5);
      expect(response.body.data.pagination).toHaveProperty("offset", 0);
    });
  });

  describe("GET /api/indexer/events/loan/:loanId", () => {
    it("should return events for a specific loan", async () => {
      const testLoanId = 1;

      const response = await request(app)
        .get(`/api/indexer/events/loan/${testLoanId}`)
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body.data).toHaveProperty("loanId", testLoanId);
      expect(response.body.data).toHaveProperty("events");
      expect(Array.isArray(response.body.data.events)).toBe(true);
    });
  });
});

describe("Event Indexer Database", () => {
  it("should have indexer_state table", async () => {
    const result = await query(
      "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'indexer_state')",
      [],
    );
    expect(result.rows[0].exists).toBe(true);
  });

  it("should have loan_events table", async () => {
    const result = await query(
      "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'loan_events')",
      [],
    );
    expect(result.rows[0].exists).toBe(true);
  });

  it("should have proper indexes on loan_events", async () => {
    const result = await query(
      `SELECT indexname FROM pg_indexes 
       WHERE tablename = 'loan_events'`,
      [],
    );

    const indexNames = result.rows.map((row) => row.indexname);
    expect(indexNames).toContain("loan_events_event_type_idx");
    expect(indexNames).toContain("loan_events_borrower_idx");
  });
});
