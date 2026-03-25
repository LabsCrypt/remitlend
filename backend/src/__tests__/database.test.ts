import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import {
  UserProfileService,
  LoanHistoryService,
  IndexedEventsService,
  DatabaseService,
} from "../services/databaseService.js";
import { query } from "../db/connection.js";

let databaseAvailable = false;

beforeAll(async () => {
  try {
    await query("SELECT 1");
    databaseAvailable = true;
  } catch {
    databaseAvailable = false;
  }
});

const describeIf = (name: string, fn: () => void) => {
  if (databaseAvailable) {
    describe(name, fn);
  } else {
    describe.skip(`${name} (skipped: no database)`, fn);
  }
};

describeIf("Database Services", () => {
  beforeAll(async () => {
    try {
      await query(`
        CREATE TABLE IF NOT EXISTS user_profiles (
          id SERIAL PRIMARY KEY,
          public_key VARCHAR(255) NOT NULL UNIQUE,
          display_name VARCHAR(255),
          email VARCHAR(255),
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          metadata JSONB
        )
      `);

      await query(`
        CREATE TABLE IF NOT EXISTS loan_history (
          id SERIAL PRIMARY KEY,
          loan_id INTEGER NOT NULL,
          borrower_public_key VARCHAR(255) NOT NULL,
          lender_public_key VARCHAR(255),
          principal_amount NUMERIC NOT NULL,
          interest_rate_bps INTEGER NOT NULL,
          principal_paid NUMERIC DEFAULT 0,
          interest_paid NUMERIC DEFAULT 0,
          accrued_interest NUMERIC DEFAULT 0,
          status VARCHAR(50) NOT NULL,
          due_date TIMESTAMP,
          requested_at TIMESTAMP,
          approved_at TIMESTAMP,
          repaid_at TIMESTAMP,
          defaulted_at TIMESTAMP,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          metadata JSONB
        )
      `);

      await query(`
        CREATE TABLE IF NOT EXISTS indexed_events (
          id SERIAL PRIMARY KEY,
          event_id VARCHAR(255) NOT NULL UNIQUE,
          event_type VARCHAR(50) NOT NULL,
          contract_id VARCHAR(255) NOT NULL,
          tx_hash VARCHAR(255) NOT NULL,
          ledger INTEGER NOT NULL,
          ledger_closed_at TIMESTAMP NOT NULL,
          topics JSONB,
          value TEXT,
          processed BOOLEAN NOT NULL DEFAULT false,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
    } catch (error) {
      console.error("Migration error:", error);
    }
  });

  afterAll(async () => {
    try {
      await query("DROP TABLE IF EXISTS user_profiles");
      await query("DROP TABLE IF EXISTS loan_history");
      await query("DROP TABLE IF EXISTS indexed_events");
    } catch (error) {
      console.error("Cleanup error:", error);
    }
  });

  describe("UserProfileService", () => {
    const testPublicKey = "G_TEST_PUBLIC_KEY_12345";

    afterAll(async () => {
      await query("DELETE FROM user_profiles WHERE public_key LIKE $1", [
        "G_TEST%",
      ]);
    });

    it("should create a user profile", async () => {
      const profile = await UserProfileService.create({
        public_key: testPublicKey,
        display_name: "Test User",
        email: "test@example.com",
      });

      expect(profile).toBeDefined();
      expect(profile.public_key).toBe(testPublicKey);
      expect(profile.display_name).toBe("Test User");
      expect(profile.email).toBe("test@example.com");
    });

    it("should find profile by public key", async () => {
      const profile = await UserProfileService.findByPublicKey(testPublicKey);
      expect(profile).toBeDefined();
      expect(profile?.public_key).toBe(testPublicKey);
    });

    it("should update a user profile", async () => {
      const updated = await UserProfileService.update(testPublicKey, {
        display_name: "Updated Name",
      });
      expect(updated).toBeDefined();
      expect(updated?.display_name).toBe("Updated Name");
    });

    it("should upsert a user profile", async () => {
      const profile = await UserProfileService.upsert({
        public_key: "G_TEST_UPSERT_KEY",
        display_name: "Upserted User",
      });

      expect(profile).toBeDefined();
      expect(profile.public_key).toBe("G_TEST_UPSERT_KEY");

      const updated = await UserProfileService.upsert({
        public_key: "G_TEST_UPSERT_KEY",
        display_name: "Updated Upserted User",
      });

      expect(updated.display_name).toBe("Updated Upserted User");
    });

    it("should delete a user profile", async () => {
      const deleteKey = "G_TEST_DELETE_KEY";
      await UserProfileService.create({
        public_key: deleteKey,
      });

      const deleted = await UserProfileService.delete(deleteKey);
      expect(deleted).toBe(true);

      const profile = await UserProfileService.findByPublicKey(deleteKey);
      expect(profile).toBeNull();
    });
  });

  describe("LoanHistoryService", () => {
    it("should create a loan history record", async () => {
      const loan = await LoanHistoryService.create({
        loan_id: 99999,
        borrower_public_key: "G_BORROWER_TEST",
        principal_amount: 1000,
        interest_rate_bps: 1200,
        status: "Pending",
      });

      expect(loan).toBeDefined();
      expect(loan.loan_id).toBe(99999);
      expect(loan.borrower_public_key).toBe("G_BORROWER_TEST");
      expect(loan.status).toBe("Pending");

      await query("DELETE FROM loan_history WHERE loan_id = $1", [99999]);
    });

    it("should find loans by borrower", async () => {
      await LoanHistoryService.create({
        loan_id: 90001,
        borrower_public_key: "G_BORROWER_FIND_TEST",
        principal_amount: 1000,
        interest_rate_bps: 1200,
        status: "Approved",
      });

      const loans = await LoanHistoryService.findByBorrower(
        "G_BORROWER_FIND_TEST",
      );
      expect(loans.length).toBeGreaterThan(0);
      if (loans[0]) {
        expect(loans[0].borrower_public_key).toBe("G_BORROWER_FIND_TEST");
      }

      await query("DELETE FROM loan_history WHERE loan_id = $1", [90001]);
    });

    it("should update loan status", async () => {
      await LoanHistoryService.create({
        loan_id: 90002,
        borrower_public_key: "G_BORROWER_UPDATE_TEST",
        principal_amount: 1000,
        interest_rate_bps: 1200,
        status: "Approved",
      });

      const updated = await LoanHistoryService.update(90002, {
        status: "Repaid",
        repaid_at: new Date(),
      });

      expect(updated).toBeDefined();
      expect(updated?.status).toBe("Repaid");

      await query("DELETE FROM loan_history WHERE loan_id = $1", [90002]);
    });
  });

  describe("IndexedEventsService", () => {
    it("should create an indexed event", async () => {
      const event = await IndexedEventsService.create({
        event_id: "event_test_001",
        event_type: "LoanRequested",
        contract_id: "CONTRACT_TEST",
        tx_hash: "tx_hash_test",
        ledger: 12345,
        ledger_closed_at: new Date(),
      });

      expect(event).toBeDefined();
      expect(event.event_id).toBe("event_test_001");
      expect(event.processed).toBe(false);
    });

    it("should find unprocessed events", async () => {
      await IndexedEventsService.create({
        event_id: "event_unprocessed_001",
        event_type: "LoanApproved",
        contract_id: "CONTRACT_TEST",
        tx_hash: "tx_hash_unprocessed",
        ledger: 12346,
        ledger_closed_at: new Date(),
      });

      const unprocessed = await IndexedEventsService.findUnprocessed();
      expect(unprocessed.length).toBeGreaterThan(0);
      expect(
        unprocessed.some((e) => e.event_id === "event_unprocessed_001"),
      ).toBe(true);
    });

    it("should mark event as processed", async () => {
      await IndexedEventsService.create({
        event_id: "event_mark_processed",
        event_type: "LoanRepaid",
        contract_id: "CONTRACT_TEST",
        tx_hash: "tx_hash_mark",
        ledger: 12347,
        ledger_closed_at: new Date(),
      });

      const marked = await IndexedEventsService.markProcessed(
        "event_mark_processed",
      );
      expect(marked).toBe(true);
    });

    it("should find events by transaction hash", async () => {
      const events = await IndexedEventsService.findByTxHash("tx_hash_test");
      expect(events.length).toBeGreaterThan(0);
    });

    afterAll(async () => {
      await query("DELETE FROM indexed_events WHERE event_id LIKE $1", [
        "event_%",
      ]);
    });
  });

  describe("DatabaseService", () => {
    it("should perform health check", async () => {
      const healthy = await DatabaseService.healthCheck();
      expect(healthy).toBe(true);
    });
  });
});
