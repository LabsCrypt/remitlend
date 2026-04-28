import request from "supertest";
import {
  Server,
  TransactionBuilder,
  Networks,
  Keypair,
  Asset,
} from "stellar-sdk";
import app from "../../src/app"; // Adjust this path to your Express/Fastify app entry point

// Mock the Stellar SDK to prevent actual network calls during integration tests
jest.mock("stellar-sdk", () => {
  const originalModule = jest.requireActual("stellar-sdk");
  return {
    ...originalModule,
    Server: jest.fn().mockImplementation(() => ({
      submitTransaction: jest.fn(),
    })),
  };
});

describe("Remittance Integration Tests", () => {
  let mockSubmit: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    // Get reference to the mocked submitTransaction method
    const serverInstance = new Server("https://horizon-testnet.stellar.org");
    mockSubmit = serverInstance.submitTransaction as jest.Mock;
  });

  it("should successfully process a signed XDR and return Stellar confirmation", async () => {
    // 1. Setup: Create a valid (but dummy) signed XDR
    const sourceKeypair = Keypair.random();
    const destination = Keypair.random().publicKey();
    const account = new (jest.requireActual("stellar-sdk").Account)(
      sourceKeypair.publicKey(),
      "1"
    );

    const transaction = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        jest.requireActual("stellar-sdk").Operation.payment({
          destination,
          asset: Asset.native(),
          amount: "10",
        })
      )
      .setTimeout(30)
      .build();

    transaction.sign(sourceKeypair);
    const signedXdr = transaction.toXDR();

    // 2. Mock Horizon Response: Simulate a successful ledger inclusion
    mockSubmit.mockResolvedValue({
      successful: true,
      hash: "abc123hash",
      ledger: 12345,
      envelope_xdr: signedXdr,
      result_xdr: "AAAAAAAAAGQAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAA=",
    });

    // 3. Execution: Send the XDR to your remittance endpoint
    const response = await request(app)
      .post("/api/remittance/submit")
      .send({ xdr: signedXdr });

    // 4. Verification: Assert the API response and internal logic
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: "confirmed",
      txHash: "abc123hash",
      ledger: 12345,
    });

    expect(mockSubmit).toHaveBeenCalledTimes(1);
  });

  it("should return 400 when the Stellar network rejects the transaction", async () => {
    mockSubmit.mockRejectedValue({
      response: {
        data: { extras: { result_codes: { transaction: "tx_bad_auth" } } },
      },
    });

    const response = await request(app)
      .post("/api/remittance/submit")
      .send({ xdr: "base64-xdr-string" });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("tx_bad_auth");
  });
});
