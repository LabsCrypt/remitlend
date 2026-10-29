/**
 * hooks/useTransactionPreview.test.ts
 *
 * Unit tests for useTransactionPreview (#2123):
 *  - Successful transaction preview (show, confirm, loading states, close, data cleanup timeout)
 *  - Malformed XDR / invalid preview data handling during transaction execution callback
 *  - Simulation failures (rejection, keeping modal open for retry, resetting loading state)
 *  - Network mismatch detection and error handling
 *  - Boundary and edge cases (calling confirm when closed, repeated calls, state recovery)
 *  - Authorization paths (wallet authorization success and user rejection)
 */

import { renderHook, act } from "@testing-library/react";
import { useTransactionPreview } from "./useTransactionPreview";
import type { TransactionPreviewData } from "../components/transaction/TransactionPreviewModal";
import {
  formatDeposit,
  formatLoanRepayment,
  formatRemittanceSend,
} from "../utils/transactionFormatter";

describe("useTransactionPreview", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const validPreviewData: TransactionPreviewData = {
    operations: [
      {
        type: "Deposit",
        description: "You are depositing 100 USDC",
        amount: "100",
        token: "USDC",
      },
    ],
    balanceChanges: [{ token: "USDC", change: "-100", isPositive: false }],
    estimatedGasFee: "0.00001",
    network: "Stellar Testnet",
  };

  describe("A. Successful transaction preview", () => {
    it("initializes with modal closed, null data, and not loading", () => {
      const { result } = renderHook(() => useTransactionPreview());

      expect(result.current.isOpen).toBe(false);
      expect(result.current.data).toBeNull();
      expect(result.current.isLoading).toBe(false);
    });

    it("opens modal and sets transaction preview data when show() is called", () => {
      const { result } = renderHook(() => useTransactionPreview());
      const onConfirm = jest.fn().mockResolvedValue(undefined);

      act(() => {
        result.current.show(validPreviewData, onConfirm);
      });

      expect(result.current.isOpen).toBe(true);
      expect(result.current.data).toEqual(validPreviewData);
      expect(result.current.isLoading).toBe(false);
    });

    it("executes confirmation callback, manages loading state, and closes on success", async () => {
      const { result } = renderHook(() => useTransactionPreview());
      let resolveCallback!: () => void;
      const onConfirm = jest.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveCallback = resolve;
          }),
      );

      act(() => {
        result.current.show(validPreviewData, onConfirm);
      });

      let confirmPromise!: Promise<void>;
      act(() => {
        confirmPromise = result.current.confirm();
      });

      // While executing onConfirm: loading state must be true
      expect(result.current.isLoading).toBe(true);
      expect(result.current.isOpen).toBe(true);

      // Resolve the execution
      await act(async () => {
        resolveCallback();
        await confirmPromise;
      });

      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.isOpen).toBe(false);

      // After 300ms close animation delay, data should be cleaned up
      act(() => {
        jest.advanceTimersByTime(300);
      });

      expect(result.current.data).toBeNull();
    });

    it("uses formatted preview fixtures from transactionFormatter utilities", () => {
      const { result } = renderHook(() => useTransactionPreview());
      const depositPreview = formatDeposit({ amount: 50, token: "USDC" });
      const onConfirm = jest.fn().mockResolvedValue(undefined);

      act(() => {
        result.current.show(depositPreview, onConfirm);
      });

      expect(result.current.data?.operations[0].description).toContain("depositing 50 USDC");
      expect(result.current.data?.network).toBe("Stellar Testnet");
    });
  });

  describe("B. Malformed XDR / invalid preview data", () => {
    it("handles callback error caused by malformed XDR parsing without leaving hook in broken state", async () => {
      const { result } = renderHook(() => useTransactionPreview());
      const malformedPreviewData: TransactionPreviewData = {
        operations: [
          {
            type: "Repay Loan",
            description: "Invalid transaction XDR format",
            details: { XDR: "INVALID_XDR_STRING_!!!" },
          },
        ],
        balanceChanges: [],
        estimatedGasFee: "0",
        network: "Stellar Testnet",
      };

      const xdrParseError = new Error("Invalid transaction XDR format");
      const onConfirm = jest.fn().mockRejectedValue(xdrParseError);

      act(() => {
        result.current.show(malformedPreviewData, onConfirm);
      });

      await act(async () => {
        await result.current.confirm();
      });

      expect(onConfirm).toHaveBeenCalledTimes(1);
      // Hook catches callback error: loading resets to false, modal remains open for correction
      expect(result.current.isLoading).toBe(false);
      expect(result.current.isOpen).toBe(true);
      expect(result.current.data).toEqual(malformedPreviewData);
    });

    it("retains modal open state when empty/malformed inputs fail during confirmation", async () => {
      const { result } = renderHook(() => useTransactionPreview());
      const emptyPreview: TransactionPreviewData = {
        operations: [],
        balanceChanges: [],
        network: "",
      };

      const onConfirm = jest.fn().mockRejectedValue(new Error("Empty transaction payload"));

      act(() => {
        result.current.show(emptyPreview, onConfirm);
      });

      await act(async () => {
        await result.current.confirm();
      });

      expect(result.current.isLoading).toBe(false);
      expect(result.current.isOpen).toBe(true);
    });
  });

  describe("C. Simulation failure", () => {
    it("resets isLoading to false and keeps modal open when transaction simulation fails", async () => {
      const { result } = renderHook(() => useTransactionPreview());
      const simulationError = new Error(
        "Transaction simulation failed: HostError(Error(Contract, #1))",
      );
      const onConfirm = jest.fn().mockRejectedValue(simulationError);

      act(() => {
        result.current.show(validPreviewData, onConfirm);
      });

      await act(async () => {
        await result.current.confirm();
      });

      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.isOpen).toBe(true);
      // Data is retained so user can inspect preview details before retrying or canceling
      expect(result.current.data).toEqual(validPreviewData);
    });

    it("allows retry after simulation failure", async () => {
      const { result } = renderHook(() => useTransactionPreview());
      const onConfirm = jest
        .fn()
        .mockRejectedValueOnce(new Error("Simulation timeout"))
        .mockResolvedValueOnce(undefined);

      act(() => {
        result.current.show(validPreviewData, onConfirm);
      });

      // First attempt fails simulation
      await act(async () => {
        await result.current.confirm();
      });

      expect(result.current.isOpen).toBe(true);
      expect(result.current.isLoading).toBe(false);

      // User retries confirmation
      await act(async () => {
        await result.current.confirm();
      });

      expect(onConfirm).toHaveBeenCalledTimes(2);
      expect(result.current.isOpen).toBe(false);
    });
  });

  describe("D. Network mismatch", () => {
    it("handles network mismatch failure thrown by confirmation handler", async () => {
      const { result } = renderHook(() => useTransactionPreview());
      const mismatchPreview: TransactionPreviewData = {
        ...validPreviewData,
        network: "Stellar Mainnet",
      };

      const networkError = new Error(
        "Network mismatch: expected Stellar Testnet but wallet is on Mainnet",
      );
      const onConfirm = jest.fn().mockRejectedValue(networkError);

      act(() => {
        result.current.show(mismatchPreview, onConfirm);
      });

      await act(async () => {
        await result.current.confirm();
      });

      expect(result.current.isLoading).toBe(false);
      expect(result.current.isOpen).toBe(true);
      expect(result.current.data?.network).toBe("Stellar Mainnet");
    });
  });

  describe("E. Boundary and edge cases", () => {
    it("does nothing if confirm() is called without showing preview first", async () => {
      const { result } = renderHook(() => useTransactionPreview());

      await act(async () => {
        await result.current.confirm();
      });

      expect(result.current.isOpen).toBe(false);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.data).toBeNull();
    });

    it("resets loading state immediately and clears data after 300ms when close() is called", () => {
      const { result } = renderHook(() => useTransactionPreview());
      const onConfirm = jest.fn().mockResolvedValue(undefined);

      act(() => {
        result.current.show(validPreviewData, onConfirm);
      });

      act(() => {
        result.current.close();
      });

      expect(result.current.isOpen).toBe(false);
      expect(result.current.isLoading).toBe(false);
      // Data remains briefly during close animation
      expect(result.current.data).toEqual(validPreviewData);

      // Advance animation timer
      act(() => {
        jest.advanceTimersByTime(300);
      });

      expect(result.current.data).toBeNull();
    });

    it("updates preview data and callback when show() is called repeatedly", async () => {
      const { result } = renderHook(() => useTransactionPreview());
      const firstData = formatLoanRepayment({ loanId: 101, amount: 100 });
      const secondData = formatRemittanceSend({
        amount: 250,
        recipient: "GABCDEFGHIJKLMNOPQRSTUVWXYZ12345678901234567890123456",
        token: "USDC",
      });

      const firstCallback = jest.fn().mockResolvedValue(undefined);
      const secondCallback = jest.fn().mockResolvedValue(undefined);

      act(() => {
        result.current.show(firstData, firstCallback);
      });

      expect(result.current.data).toEqual(firstData);

      act(() => {
        result.current.show(secondData, secondCallback);
      });

      expect(result.current.data).toEqual(secondData);

      await act(async () => {
        await result.current.confirm();
      });

      expect(firstCallback).not.toHaveBeenCalled();
      expect(secondCallback).toHaveBeenCalledTimes(1);
    });

    it("does not leak stale errors across consecutive failed and successful preview sessions", async () => {
      const { result } = renderHook(() => useTransactionPreview());

      // Session 1: Fails
      const failCallback = jest.fn().mockRejectedValue(new Error("First attempt error"));
      act(() => {
        result.current.show(validPreviewData, failCallback);
      });

      await act(async () => {
        await result.current.confirm();
      });

      expect(result.current.isOpen).toBe(true);

      // User closes modal
      act(() => {
        result.current.close();
        jest.advanceTimersByTime(300);
      });

      // Session 2: Succeeds
      const successCallback = jest.fn().mockResolvedValue(undefined);
      act(() => {
        result.current.show(validPreviewData, successCallback);
      });

      await act(async () => {
        await result.current.confirm();
      });

      expect(result.current.isOpen).toBe(false);
      expect(result.current.isLoading).toBe(false);
    });
  });

  describe("F. Authorization paths", () => {
    it("handles wallet authorization approval flow", async () => {
      const { result } = renderHook(() => useTransactionPreview());
      const authorizeAndExecute = jest.fn().mockImplementation(async () => {
        // Simulates wallet signature prompt approval
        return Promise.resolve();
      });

      act(() => {
        result.current.show(validPreviewData, authorizeAndExecute);
      });

      await act(async () => {
        await result.current.confirm();
      });

      expect(authorizeAndExecute).toHaveBeenCalledTimes(1);
      expect(result.current.isOpen).toBe(false);
    });

    it("handles wallet authorization rejection (user rejected signing in wallet)", async () => {
      const { result } = renderHook(() => useTransactionPreview());
      const walletRejectionError = new Error("User rejected transaction in wallet");
      const authorizeAndExecute = jest.fn().mockRejectedValue(walletRejectionError);

      act(() => {
        result.current.show(validPreviewData, authorizeAndExecute);
      });

      await act(async () => {
        await result.current.confirm();
      });

      expect(authorizeAndExecute).toHaveBeenCalledTimes(1);
      // On wallet rejection, modal stays open so user can re-try or cancel manually
      expect(result.current.isLoading).toBe(false);
      expect(result.current.isOpen).toBe(true);
    });
  });
});
