import {
  mapTransactionError,
  fetchTransactionStatus,
  pollTransactionStatus,
} from "./transactionErrors";

describe("transactionErrors", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe("mapTransactionError", () => {
    it("maps wallet rejection errors correctly", () => {
      const error = mapTransactionError(new Error("User rejected the transaction"));
      expect(error.category).toBe("wallet_rejected");
      expect(error.retryable).toBe(true);
      expect(error.cancelledByUser).toBe(true);
    });

    it("maps network timeout errors correctly", () => {
      const error = mapTransactionError(new Error("Network request timeout"));
      expect(error.category).toBe("network_timeout");
      expect(error.retryable).toBe(true);
      expect(error.cancelledByUser).toBe(false);
    });

    it("maps insufficient balance errors correctly", () => {
      const error = mapTransactionError(new Error("Insufficient balance for operation"));
      expect(error.category).toBe("insufficient_balance");
      expect(error.retryable).toBe(false);
    });

    it("maps score too low errors correctly", () => {
      const error = mapTransactionError(new Error("Credit score too low"));
      expect(error.category).toBe("score_too_low");
      expect(error.retryable).toBe(false);
    });

    it("maps simulation failed errors correctly", () => {
      const error = mapTransactionError(new Error("Simulation failed"));
      expect(error.category).toBe("simulation_failed");
      expect(error.retryable).toBe(true);
    });

    it("maps on-chain failure errors correctly", () => {
      const error = mapTransactionError(new Error("Tx failed on-chain"));
      expect(error.category).toBe("onchain_failure");
      expect(error.retryable).toBe(false);
    });

    it("maps unknown errors correctly", () => {
      const error = mapTransactionError("Some random unexpected error");
      expect(error.category).toBe("unknown");
      expect(error.message).toBe("Some random unexpected error");
      expect(error.retryable).toBe(true);
    });
  });

  describe("fetchTransactionStatus", () => {
    it("returns 'pending' when Horizon returns 404 (not yet in history)", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        status: 404,
        ok: false,
      } as Response);

      const status = await fetchTransactionStatus(
        "tx-hash-123",
        "https://horizon-testnet.stellar.org",
      );
      expect(status).toBe("pending");
      expect(global.fetch).toHaveBeenCalledWith(
        "https://horizon-testnet.stellar.org/transactions/tx-hash-123",
        { signal: undefined },
      );
    });

    it("returns 'success' when Horizon returns 200 with successful: true", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({ successful: true }),
      } as Response);

      const status = await fetchTransactionStatus(
        "tx-hash-123",
        "https://horizon-testnet.stellar.org",
      );
      expect(status).toBe("success");
    });

    it("returns 'failed' when Horizon returns 200 with successful: false", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({ successful: false }),
      } as Response);

      const status = await fetchTransactionStatus(
        "tx-hash-123",
        "https://horizon-testnet.stellar.org",
      );
      expect(status).toBe("failed");
    });

    it("throws an error when Horizon returns non-404 error status (e.g. 500)", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        status: 500,
        ok: false,
      } as Response);

      await expect(
        fetchTransactionStatus("tx-hash-123", "https://horizon-testnet.stellar.org"),
      ).rejects.toThrow("Unable to fetch transaction status (500)");
    });
  });

  describe("pollTransactionStatus", () => {
    it("resolves to success immediately when first poll returns successful transaction", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({ successful: true }),
      } as Response);

      const result = await pollTransactionStatus("tx-123", {
        horizonUrl: "https://horizon.example.com",
        intervalMs: 10,
        timeoutMs: 1000,
      });

      expect(result).toEqual({
        status: "success",
        message: "Transaction confirmed on-chain.",
      });
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it("resolves to failed immediately when first poll returns failed transaction", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({ successful: false }),
      } as Response);

      const result = await pollTransactionStatus("tx-123", {
        horizonUrl: "https://horizon.example.com",
        intervalMs: 10,
        timeoutMs: 1000,
      });

      expect(result).toEqual({
        status: "failed",
        message: "Transaction failed on-chain.",
      });
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it("tolerates transient 500 error, continues polling, and resolves when subsequent call succeeds", async () => {
      let callCount = 0;
      global.fetch = jest.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          // Injected transient 500 internal server error
          return {
            status: 500,
            ok: false,
          } as Response;
        }
        // Subsequent successful response
        return {
          status: 200,
          ok: true,
          json: async () => ({ successful: true }),
        } as Response;
      });

      const result = await pollTransactionStatus("tx-123", {
        horizonUrl: "https://horizon.example.com",
        intervalMs: 10,
        timeoutMs: 2000,
      });

      expect(result).toEqual({
        status: "success",
        message: "Transaction confirmed on-chain.",
      });
      expect(callCount).toBe(2);
    });

    it("tolerates 404 pending status followed by 429 rate limit, 502 bad gateway, and network rejection before succeeding", async () => {
      let callCount = 0;
      global.fetch = jest.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return { status: 404, ok: false } as Response;
        }
        if (callCount === 2) {
          return { status: 429, ok: false } as Response;
        }
        if (callCount === 3) {
          return { status: 502, ok: false } as Response;
        }
        if (callCount === 4) {
          throw new TypeError("Failed to fetch");
        }
        return {
          status: 200,
          ok: true,
          json: async () => ({ successful: true }),
        } as Response;
      });

      const result = await pollTransactionStatus("tx-123", {
        horizonUrl: "https://horizon.example.com",
        intervalMs: 10,
        timeoutMs: 2000,
      });

      expect(result).toEqual({
        status: "success",
        message: "Transaction confirmed on-chain.",
      });
      expect(callCount).toBe(5);
    });

    it("returns timeout when transaction remains pending / encountering errors until timeoutMs", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        status: 500,
        ok: false,
      } as Response);

      const result = await pollTransactionStatus("tx-123", {
        horizonUrl: "https://horizon.example.com",
        intervalMs: 20,
        timeoutMs: 80,
      });

      expect(result).toEqual({
        status: "timeout",
        message: "Transaction is still pending. You can retry status tracking.",
      });
    });

    it("returns cancelled when AbortSignal is aborted", async () => {
      const controller = new AbortController();
      controller.abort();

      const result = await pollTransactionStatus("tx-123", {
        horizonUrl: "https://horizon.example.com",
        intervalMs: 10,
        timeoutMs: 1000,
        signal: controller.signal,
      });

      expect(result).toEqual({
        status: "cancelled",
        message: "Status tracking cancelled by user.",
      });
    });
  });
});
