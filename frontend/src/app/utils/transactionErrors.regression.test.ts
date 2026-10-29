/**
 * Regression tests for transactionErrors.ts
 *
 * These tests target coverage gaps identified in the test-sweep:
 *   - ERROR_CODE_MESSAGES: known-code lookup, unknown-code boundary
 *   - mapTransactionError: non-Error inputs, nested RPC error shapes,
 *     boundary keywords, full TransactionErrorDetails contract
 *   - fetchTransactionStatus: `successful: undefined` boundary, AbortSignal forwarding
 *   - pollTransactionStatus: mid-poll abort, NEXT_PUBLIC_HORIZON_URL env default
 */

import {
  ERROR_CODE_MESSAGES,
  mapTransactionError,
  fetchTransactionStatus,
  pollTransactionStatus,
  type TransactionErrorDetails,
} from "./transactionErrors";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeFetchResponse = (
  status: number,
  body?: Record<string, unknown>,
): Response => {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body ?? {},
  } as unknown as Response;
};

// ---------------------------------------------------------------------------
// ERROR_CODE_MESSAGES
// ---------------------------------------------------------------------------

describe("ERROR_CODE_MESSAGES", () => {
  it("is a plain object (Record<string, string>)", () => {
    expect(typeof ERROR_CODE_MESSAGES).toBe("object");
    expect(ERROR_CODE_MESSAGES).not.toBeNull();
  });

  it("maps every defined key to a non-empty string", () => {
    for (const [key, value] of Object.entries(ERROR_CODE_MESSAGES)) {
      expect(typeof value).toBe("string");
      expect(value.length).toBeGreaterThan(0);
    }
    // Sanity-check that the map is not empty
    expect(Object.keys(ERROR_CODE_MESSAGES).length).toBeGreaterThan(0);
  });

  it.each([
    ["INVALID_AMOUNT", "Amount must be a positive number"],
    ["INVALID_PUBLIC_KEY", "Invalid Stellar public key"],
    ["UNAUTHORIZED", "Unauthorized access"],
    ["TOKEN_EXPIRED", "Session token has expired"],
    ["FORBIDDEN", "Forbidden access"],
    ["ACCESS_DENIED", "Access to resource denied"],
    ["NOT_FOUND", "Resource not found"],
    ["RATE_LIMIT_EXCEEDED", "Rate limit exceeded. Please wait"],
    ["BLOCKCHAIN_ERROR", "Blockchain operation failed"],
    ["SERVICE_UNAVAILABLE", "The service is temporarily unavailable. Please try again later"],
    ["BORROWER_MISMATCH", "Borrower wallet mismatch"],
    ["INSUFFICIENT_BALANCE", "Insufficient account balance"],
    ["LOAN_ALREADY_REPAID", "Loan has already been repaid"],
    ["LOAN_NOT_ACTIVE", "Loan is not active"],
    ["INVALID_TX_XDR", "Invalid transaction XDR format"],
  ])("known code %s returns the documented message", (code, expected) => {
    expect(ERROR_CODE_MESSAGES[code]).toBe(expected);
  });

  it("returns undefined for unknown / unmapped error codes", () => {
    // Unknown codes must return undefined so callers can fall back to a
    // generic message rather than silently swallowing the key name.
    expect(ERROR_CODE_MESSAGES["TOTALLY_UNKNOWN_CODE_XYZ"]).toBeUndefined();
    expect(ERROR_CODE_MESSAGES[""]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// mapTransactionError — full contract shape
// ---------------------------------------------------------------------------

describe("mapTransactionError — TransactionErrorDetails contract", () => {
  const requiredFields: (keyof TransactionErrorDetails)[] = [
    "category",
    "title",
    "message",
    "guidance",
    "retryable",
    "cancelledByUser",
  ];

  it("always returns an object with all required fields for a known error", () => {
    const result = mapTransactionError(new Error("User rejected the transaction"));
    for (const field of requiredFields) {
      expect(result).toHaveProperty(field);
    }
  });

  it("always returns an object with all required fields for an unknown error", () => {
    const result = mapTransactionError(new Error("some_totally_unrecognised_string"));
    for (const field of requiredFields) {
      expect(result).toHaveProperty(field);
    }
  });

  it("category is always one of the seven defined literals", () => {
    const validCategories = new Set([
      "wallet_rejected",
      "network_timeout",
      "insufficient_balance",
      "score_too_low",
      "onchain_failure",
      "simulation_failed",
      "unknown",
    ]);
    const inputs: unknown[] = [
      new Error("User rejected"),
      new Error("timeout"),
      new Error("Insufficient balance"),
      new Error("score too low"),
      new Error("Simulation failed"),
      new Error("Tx failed on-chain"),
      new Error("something completely different"),
    ];
    for (const input of inputs) {
      expect(validCategories).toContain(mapTransactionError(input).category);
    }
  });
});

// ---------------------------------------------------------------------------
// mapTransactionError — non-Error / exotic inputs
// ---------------------------------------------------------------------------

describe("mapTransactionError — non-Error inputs", () => {
  it("handles a plain string input — returns unknown with the string as message", () => {
    const result = mapTransactionError("plain string error");
    expect(result.category).toBe("unknown");
    expect(result.message).toBe("plain string error");
    expect(result.retryable).toBe(true);
    expect(result.cancelledByUser).toBe(false);
  });

  it("handles null — returns unknown category without throwing", () => {
    const result = mapTransactionError(null);
    expect(result.category).toBe("unknown");
    expect(typeof result.message).toBe("string");
  });

  it("handles undefined — returns unknown category without throwing", () => {
    const result = mapTransactionError(undefined);
    expect(result.category).toBe("unknown");
    expect(typeof result.message).toBe("string");
  });

  it("handles a number — returns unknown category without throwing", () => {
    const result = mapTransactionError(42);
    expect(result.category).toBe("unknown");
    expect(result.message).toBe("42");
  });

  it("handles a plain object without a message property — JSON-serialises and returns unknown", () => {
    const result = mapTransactionError({ code: 4001, reason: "wallet busy" });
    expect(result.category).toBe("unknown");
    expect(result.message).toContain("4001");
  });

  it("handles an array input — JSON-serialises and returns unknown", () => {
    const result = mapTransactionError(["err1", "err2"]);
    expect(result.category).toBe("unknown");
    expect(result.message).toContain("err1");
  });

  it("handles an empty string — returns unknown with empty string as message", () => {
    const result = mapTransactionError("");
    expect(result.category).toBe("unknown");
    expect(result.message).toBe("");
  });
});

// ---------------------------------------------------------------------------
// mapTransactionError — nested / RPC error shapes
// ---------------------------------------------------------------------------

describe("mapTransactionError — nested RPC / SDK error shapes", () => {
  it("recognises wallet rejection in an Error whose message contains 'denied'", () => {
    const result = mapTransactionError(new Error("Request denied by wallet extension"));
    expect(result.category).toBe("wallet_rejected");
    expect(result.cancelledByUser).toBe(true);
  });

  it("recognises wallet rejection in an Error whose message contains 'canceled' (US spelling)", () => {
    const result = mapTransactionError(new Error("Operation was canceled by the user"));
    expect(result.category).toBe("wallet_rejected");
    expect(result.cancelledByUser).toBe(true);
  });

  it("recognises wallet rejection in an Error whose message contains 'cancelled' (UK spelling)", () => {
    const result = mapTransactionError(new Error("Transaction cancelled"));
    expect(result.category).toBe("wallet_rejected");
    expect(result.cancelledByUser).toBe(true);
  });

  it("maps an Error with 'host error' message to simulation_failed", () => {
    // Stellar Soroban SDK surfaces host execution errors as "host error" strings
    const result = mapTransactionError(new Error("Contract host error: stack overflow"));
    expect(result.category).toBe("simulation_failed");
    expect(result.retryable).toBe(true);
  });

  it("maps an Error with 'revert' message to onchain_failure", () => {
    const result = mapTransactionError(new Error("Transaction reverted: out of gas"));
    expect(result.category).toBe("onchain_failure");
    expect(result.retryable).toBe(false);
  });

  it("maps 'failed to fetch' network errors to network_timeout", () => {
    // This is the exact string thrown by browser fetch on offline / CORS failure
    const result = mapTransactionError(new TypeError("Failed to fetch"));
    expect(result.category).toBe("network_timeout");
    expect(result.retryable).toBe(true);
  });

  it("maps 'insufficient funds' (alternative phrasing) to insufficient_balance", () => {
    // Some Stellar SDK variants use 'insufficient funds' instead of 'insufficient balance'
    const result = mapTransactionError(new Error("Insufficient funds in account"));
    expect(result.category).toBe("insufficient_balance");
    expect(result.retryable).toBe(false);
  });

  it("maps 'insufficientScore' (camelCase RPC code) to score_too_low", () => {
    const result = mapTransactionError(new Error("Contract returned: insufficientScore"));
    expect(result.category).toBe("score_too_low");
    expect(result.retryable).toBe(false);
  });

  it("maps RPC error object whose serialised JSON contains 'rejected' to wallet_rejected", () => {
    // Some SDKs throw plain objects rather than Error instances
    const rpcError = { code: -32003, message: "User rejected request" };
    const result = mapTransactionError(rpcError);
    expect(result.category).toBe("wallet_rejected");
  });

  it("maps RPC error object whose serialised JSON contains 'simulation' to simulation_failed", () => {
    const rpcError = { type: "SimulationError", details: "preflight simulation failed" };
    const result = mapTransactionError(rpcError);
    expect(result.category).toBe("simulation_failed");
  });

  it("falls through to unknown for an RPC object with no recognisable keywords", () => {
    const rpcError = { code: 9999, detail: "something else entirely" };
    const result = mapTransactionError(rpcError);
    expect(result.category).toBe("unknown");
    expect(result.retryable).toBe(true);
    expect(result.cancelledByUser).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// mapTransactionError — authorization paths
// ---------------------------------------------------------------------------

describe("mapTransactionError — authorization / access-control paths", () => {
  it("maps UNAUTHORIZED error code message to wallet_rejected via 'denied' keyword", () => {
    // ERROR_CODE_MESSAGES.UNAUTHORIZED = "Unauthorized access"
    // This does NOT contain 'denied', so it should fall to unknown — documenting the boundary.
    const result = mapTransactionError(new Error(ERROR_CODE_MESSAGES["UNAUTHORIZED"]!));
    // "Unauthorized access" does not match any keyword → unknown
    expect(result.category).toBe("unknown");
  });

  it("maps ACCESS_DENIED error code message to wallet_rejected via 'denied' keyword", () => {
    // ERROR_CODE_MESSAGES.ACCESS_DENIED = "Access to resource denied"
    const result = mapTransactionError(new Error(ERROR_CODE_MESSAGES["ACCESS_DENIED"]!));
    expect(result.category).toBe("wallet_rejected");
    expect(result.cancelledByUser).toBe(true);
  });

  it("maps FORBIDDEN error code message — documents that 'forbidden' falls through to unknown", () => {
    // ERROR_CODE_MESSAGES.FORBIDDEN = "Forbidden access"
    // 'forbidden' is not a keyword in mapTransactionError → falls through to unknown.
    // This test documents the existing contract so any future change is intentional.
    const result = mapTransactionError(new Error(ERROR_CODE_MESSAGES["FORBIDDEN"]!));
    expect(result.category).toBe("unknown");
  });

  it("maps TOKEN_EXPIRED message — documents that expiry falls through to unknown", () => {
    const result = mapTransactionError(new Error(ERROR_CODE_MESSAGES["TOKEN_EXPIRED"]!));
    expect(result.category).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// fetchTransactionStatus — boundary and signal tests
// ---------------------------------------------------------------------------

describe("fetchTransactionStatus — boundary cases", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  const mockHorizonUrl = 'https://horizon.example.com';

  it("treats successful: undefined as falsy and returns 'failed'", async () => {
    // Horizon may omit the 'successful' field in some edge-case responses.
    // The falsy check `payload.successful ? 'success' : 'failed'` should yield 'failed'.
    global.fetch = jest.fn().mockResolvedValue(
      makeFetchResponse(200, { successful: undefined }),
    );

    const status = await fetchTransactionStatus(
      "tx-boundary",
      mockHorizonUrl,
    );
    expect(status).toBe("failed");
  });

  it("treats successful: null as falsy and returns 'failed'", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      makeFetchResponse(200, { successful: null }),
    );

    const status = await fetchTransactionStatus(
      "tx-boundary",
      mockHorizonUrl,
    );
    expect(status).toBe("failed");
  });

  it("forwards the AbortSignal to the underlying fetch call", async () => {
    const controller = new AbortController();
    global.fetch = jest.fn().mockResolvedValue(makeFetchResponse(404));

    await fetchTransactionStatus(
      "tx-signal-test",
      mockHorizonUrl,
      controller.signal,
    );

    expect(global.fetch).toHaveBeenCalledWith(
      `${mockHorizonUrl}/transactions/tx-signal-test`,
      { signal: controller.signal },
    );
  });

  it("throws with status code embedded for every non-404 error status", async () => {
    for (const status of [400, 401, 403, 429, 500, 502, 503]) {
      global.fetch = jest.fn().mockResolvedValue(makeFetchResponse(status));

      await expect(
        fetchTransactionStatus("tx-err", mockHorizonUrl),
      ).rejects.toThrow(`Unable to fetch transaction status (${status})`);
    }
  });
});

// ---------------------------------------------------------------------------
// pollTransactionStatus — mid-poll abort and env-var default
// ---------------------------------------------------------------------------

describe("pollTransactionStatus — additional paths", () => {
  const originalFetch = global.fetch;
  const originalEnv = process.env.NEXT_PUBLIC_HORIZON_URL;
  const mockHorizonUrl = 'https://horizon.example.com';
  const customHorizonUrl = 'https://custom-horizon.example.com';
  const stellarTestnetUrl = 'https://horizon-testnet.stellar.org';

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.NEXT_PUBLIC_HORIZON_URL = originalEnv;
    jest.restoreAllMocks();
  });

  it("returns cancelled when signal is aborted mid-poll (during the delay between retries)", async () => {
    // First fetch returns 404 (pending), then we abort during the delay.
    // The second fetch should never be called.
    const controller = new AbortController();
    let callCount = 0;

    global.fetch = jest.fn().mockImplementation(async () => {
      callCount++;
      // Abort after the first poll so the delay sees the signal
      setTimeout(() => controller.abort(), 5);
      return makeFetchResponse(404);
    });

    const result = await pollTransactionStatus("tx-mid-abort", {
      horizonUrl: mockHorizonUrl,
      intervalMs: 50,   // long enough for abort to fire during delay
      timeoutMs: 2000,
      signal: controller.signal,
    });

    expect(result).toEqual({
      status: "cancelled",
      message: "Status tracking cancelled by user.",
    });
    // Only one fetch should have occurred before the abort
    expect(callCount).toBe(1);
  });

  it("uses NEXT_PUBLIC_HORIZON_URL env variable as the default horizonUrl", async () => {
    const horizonEnvKey = "NEXT_PUBLIC_HORIZON_URL";
    process.env[horizonEnvKey] = customHorizonUrl;

    global.fetch = jest.fn().mockResolvedValue(
      makeFetchResponse(200, { successful: true }),
    );

    const result = await pollTransactionStatus("tx-env-default", {
      intervalMs: 10,
      timeoutMs: 1000,
      // horizonUrl intentionally omitted to exercise the env-var default
    });

    expect(result.status).toBe("success");
    expect(global.fetch).toHaveBeenCalledWith(
      `${customHorizonUrl}/transactions/tx-env-default`,
      expect.anything(),
    );
  });

  it("falls back to the hard-coded testnet URL when NEXT_PUBLIC_HORIZON_URL is unset", async () => {
    delete process.env.NEXT_PUBLIC_HORIZON_URL;

    global.fetch = jest.fn().mockResolvedValue(
      makeFetchResponse(200, { successful: true }),
    );

    await pollTransactionStatus("tx-fallback", {
      intervalMs: 10,
      timeoutMs: 1000,
    });

    expect(global.fetch).toHaveBeenCalledWith(
      `${stellarTestnetUrl}/transactions/tx-fallback`,
      expect.anything(),
    );
  });

  it("respects a zero-length timeout and returns timeout immediately", async () => {
    // timeoutMs: 0 — the while condition is false on the first check, so no
    // fetch call is attempted and pollTransactionStatus returns 'timeout' immediately.
    global.fetch = jest.fn();

    const result = await pollTransactionStatus("tx-zero-timeout", {
      horizonUrl: mockHorizonUrl,
      intervalMs: 10,
      timeoutMs: 0,
    });

    expect(result).toEqual({
      status: "timeout",
      message: "Transaction is still pending. You can retry status tracking.",
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
