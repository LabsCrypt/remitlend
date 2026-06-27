import request from "supertest";
import { query } from "../../db/connection.js";
import { sorobanService } from "../../services/sorobanService.js";
import { app } from "../../app.js";

jest.mock("../../services/sorobanService.js");

describe("Integration: Remittance Submit Flow", () => {
  let authToken: string;
  let remittanceId: string;
  const senderAddress = "GBTEST123SENDER456STELLAR789ADDRESS000";
  const recipientAddress = "GBTEST123RECIPIENT456STELLAR789ADDRESS";
  const validSignedXdr = "AAAAAgAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";

  beforeAll(async () => {
    authToken = `Bearer test-token-${senderAddress}`;

    await query("DELETE FROM remittances WHERE sender_id = $1", [senderAddress]);

    const result = await query(
      `INSERT INTO remittances (id, sender_id, recipient_address, amount, from_currency, to_currency, status, unsigned_xdr, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW()) RETURNING id`,
      [
        "test-remittance-1",
        senderAddress,
        recipientAddress,
        "100.00",
        "USD",
        "XLM",
        "pending",
        "unsigned-xdr-here",
      ]
    );
    remittanceId = result.rows[0].id;
  });

  afterAll(async () => {
    await query("DELETE FROM remittances WHERE sender_id = $1", [senderAddress]);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should submit remittance with valid signed XDR and return transaction hash", async () => {
    const mockTxHash = "abc123def456ghi789";
    (sorobanService.submitSignedTx as jest.Mock).mockResolvedValue({
      txHash: mockTxHash,
      status: "SUCCESS",
    });

    const response = await request(app)
      .post(`/api/remittances/${remittanceId}/submit`)
      .set("Authorization", authToken)
      .send({ signedXdr: validSignedXdr })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.txHash).toBe(mockTxHash);
    expect(response.body.data.status).toBe("completed");
    expect(sorobanService.submitSignedTx).toHaveBeenCalledWith(validSignedXdr);

    const dbResult = await query(
      "SELECT status, tx_hash FROM remittances WHERE id = $1",
      [remittanceId]
    );
    expect(dbResult.rows[0].status).toBe("completed");
    expect(dbResult.rows[0].tx_hash).toBe(mockTxHash);
  });

  it("should reject invalid XDR with 400 error", async () => {
    (sorobanService.submitSignedTx as jest.Mock).mockRejectedValue(
      new Error("Invalid XDR format")
    );

    const response = await request(app)
      .post(`/api/remittances/${remittanceId}/submit`)
      .set("Authorization", authToken)
      .send({ signedXdr: "invalid-xdr" })
      .expect(500);

    expect(response.body.success).toBe(false);

    const dbResult = await query(
      "SELECT status FROM remittances WHERE id = $1",
      [remittanceId]
    );
    expect(dbResult.rows[0].status).toBe("failed");
  });

  it("should reject already-completed remittance with 400 error", async () => {
    await query(
      "UPDATE remittances SET status = $1 WHERE id = $2",
      ["completed", remittanceId]
    );

    const response = await request(app)
      .post(`/api/remittances/${remittanceId}/submit`)
      .set("Authorization", authToken)
      .send({ signedXdr: validSignedXdr })
      .expect(400);

    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain("already been submitted");

    await query(
      "UPDATE remittances SET status = $1 WHERE id = $2",
      ["pending", remittanceId]
    );
  });

  it("should reject submission from wrong sender with 403 error", async () => {
    const wrongSenderToken = `Bearer test-token-GBWRONGSENDER`;

    const response = await request(app)
      .post(`/api/remittances/${remittanceId}/submit`)
      .set("Authorization", wrongSenderToken)
      .send({ signedXdr: validSignedXdr })
      .expect(403);

    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain("do not have access");
  });

  it("should handle Stellar network rejection with 502 error message", async () => {
    const stellarError = new Error("Stellar network rejected transaction");
    (sorobanService.submitSignedTx as jest.Mock).mockRejectedValue(stellarError);

    const response = await request(app)
      .post(`/api/remittances/${remittanceId}/submit`)
      .set("Authorization", authToken)
      .send({ signedXdr: validSignedXdr })
      .expect(500);

    expect(response.body.success).toBe(false);
    expect(sorobanService.submitSignedTx).toHaveBeenCalledWith(validSignedXdr);

    const dbResult = await query(
      "SELECT status, error_message FROM remittances WHERE id = $1",
      [remittanceId]
    );
    expect(dbResult.rows[0].status).toBe("failed");
    expect(dbResult.rows[0].error_message).toContain("Stellar network");
  });
});
