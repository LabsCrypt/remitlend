import { EventIndexer } from "../../services/eventIndexer.js";
import { query } from "../../db/connection.js";
import { webhookService } from "../../services/webhookService.js";
import { eventStreamService } from "../../services/eventStreamService.js";
import { Address, nativeToScVal, xdr } from "@stellar/stellar-sdk";

describe("Integration: EventIndexer end-to-end", () => {
  const runIntegration = process.env.RUN_INDEXER_INTEGRATION === "true";

  beforeAll(async () => {
    if (!runIntegration) {
      return;
    }

    await query("DELETE FROM contract_events");
    await query("DELETE FROM indexer_state");
    await query("INSERT INTO indexer_state (last_indexed_ledger) VALUES (0)");
  });

  afterAll(async () => {
    if (!runIntegration) {
      return;
    }

    await query("DELETE FROM contract_events");
    await query("DELETE FROM indexer_state");
  });

  it("should ingest LoanApproved event and persist it to contract_events", async () => {
    if (!runIntegration) {
      console.warn(
        "Skipping integration test because RUN_INDEXER_INTEGRATION != true",
      );
      return;
    }

    const borrowerAddress = process.env.INTEGRATION_TEST_BORROWER_ADDRESS;
    if (!borrowerAddress) {
      throw new Error("INTEGRATION_TEST_BORROWER_ADDRESS must be defined");
    }

    const placeholderContractId =
      process.env.LOAN_MANAGER_CONTRACT_ID ?? "CNTRACTID1";

    const loanId = 77;
    const dummyEvent = {
      id: `loan-approved-${Date.now()}`,
      pagingToken: "dummy-token",
      topic: [
        xdr.ScVal.scvSymbol("LoanApproved"),
        nativeToScVal(loanId, { type: "u32" }),
      ],
      value: nativeToScVal(Address.fromString(borrowerAddress), {
        type: "address",
      }),
      ledger: 1000,
      ledgerClosedAt: new Date().toISOString(),
      txHash: "txhash-integration-001",
      contractId: placeholderContractId,
    };

    const dispatchSpy = jest
      .spyOn(webhookService, "dispatch")
      .mockImplementation(async () => {
        return;
      });
    const broadcastSpy = jest
      .spyOn(eventStreamService, "broadcast")
      .mockImplementation(async () => {
        return;
      });

    const indexer = new EventIndexer(
      "https://example.com",
      placeholderContractId,
    );
    // Bypass the actual Soroban RPC call for deterministic integration test
    (indexer as any).fetchEventsInRange = async () => [dummyEvent];

    const chunkResult = await (indexer as any).processChunk(1000, 1000);
    expect(chunkResult.insertedEvents).toBe(1);

    const rows = await query(
      "SELECT * FROM contract_events WHERE event_type = $1",
      ["LoanApproved"],
    );
    expect(rows.rows.length).toBe(1);

    const row = rows.rows[0];
    expect(row.loan_id).toBe(loanId);
    expect(row.address).toBe(borrowerAddress);
    expect(row.tx_hash).toBe("txhash-integration-001");

    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(broadcastSpy).toHaveBeenCalledTimes(1);

    dispatchSpy.mockRestore();
    broadcastSpy.mockRestore();
  });
});
