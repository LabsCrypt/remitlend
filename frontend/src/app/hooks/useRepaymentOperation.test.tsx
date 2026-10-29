/**
 * hooks/useRepaymentOperation.test.tsx
 *
 * Tests for #2120: deterministic coverage of the repayment operation
 * lifecycle — success, failure, boundary and authorization paths, including
 * rejected wallet signatures, signing timeout, and retry-state reset.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useRepaymentOperation } from "./useRepaymentOperation";
import { useOptimisticUI } from "./useOptimisticUI";
import { queryKeys, submitLoanTransaction, useRepayLoan } from "./useApi";
import { useWallet } from "../components/providers/WalletProvider";

jest.mock("./useApi", () => {
  const actual = jest.requireActual("./useApi");
  return {
    ...actual,
    useRepayLoan: jest.fn(),
    submitLoanTransaction: jest.fn(),
  };
});

jest.mock("../components/providers/WalletProvider", () => ({
  useWallet: jest.fn(),
}));

type RepaymentResult = { txHash: string; status: "success" };
type RepaymentOptions = { loanId: number; amount: number; borrowerAddress: string };

const LOAN_ID = 7;
const AMOUNT = 250;
const BORROWER = "GBORROWERADDRESS123456789";
const LOAN: RepaymentOptions = { loanId: LOAN_ID, amount: AMOUNT, borrowerAddress: BORROWER };

const UNSIGNED_XDR = "unsigned-repayment-xdr";
const NETWORK_PASSPHRASE = "Test ; Network ; February 2027";
const SIGNED_XDR = "signed-repayment-xdr";
const TX_HASH = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2";

const BUILD_RESULT = { unsignedTxXdr: UNSIGNED_XDR, networkPassphrase: NETWORK_PASSPHRASE };

let mockBuildRepayment: jest.Mock;
let mockSignTransaction: jest.Mock;

const createTestHarness = (hookOptions?: Parameters<typeof useRepaymentOperation>[0]) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const rendered = renderHook(() => useRepaymentOperation(hookOptions), { wrapper });
  return { ...rendered, queryClient };
};

/** The zustand transaction record owned by this hook instance (id is useId-based). */
const getRepaymentTxState = () => {
  const { transactions } = useOptimisticUI.getState();
  return Object.values(transactions).find((tx) => tx.id.startsWith("repayment-"));
};

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe("useRepaymentOperation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useOptimisticUI.getState().clearAllTransactions();

    mockBuildRepayment = jest.fn().mockResolvedValue(BUILD_RESULT);
    jest.mocked(useRepayLoan).mockReturnValue({
      mutateAsync: mockBuildRepayment,
    } as unknown as ReturnType<typeof useRepayLoan>);

    jest.mocked(submitLoanTransaction).mockResolvedValue({ txHash: TX_HASH, status: "SUCCESS" });

    mockSignTransaction = jest.fn().mockResolvedValue(SIGNED_XDR);
    jest
      .mocked(useWallet)
      .mockReturnValue({ signTransaction: mockSignTransaction } as unknown as ReturnType<
        typeof useWallet
      >);
  });

  describe("success path", () => {
    it("builds, signs, submits and confirms the repayment end to end", async () => {
      const onSuccess = jest.fn();
      const onError = jest.fn();
      const { result, queryClient } = createTestHarness({ onSuccess, onError });
      const invalidateSpy = jest.spyOn(queryClient, "invalidateQueries");

      let txResult: RepaymentResult | undefined;
      await act(async () => {
        txResult = await result.current.executeRepayment(LOAN);
      });

      expect(txResult).toEqual({ txHash: TX_HASH, status: "success" });
      expect(mockBuildRepayment).toHaveBeenCalledWith(LOAN);
      expect(mockSignTransaction).toHaveBeenCalledWith(UNSIGNED_XDR, {
        networkPassphrase: NETWORK_PASSPHRASE,
      });
      expect(submitLoanTransaction).toHaveBeenCalledWith(SIGNED_XDR);

      expect(onSuccess).toHaveBeenCalledWith({ txHash: TX_HASH, status: "success" });
      expect(onError).not.toHaveBeenCalled();
      expect(result.current.error).toBeNull();

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: queryKeys.loans.detail(String(LOAN_ID)),
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: queryKeys.borrowerLoans.byAddress(BORROWER),
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: queryKeys.loans.borrowerPagePrefix(BORROWER),
      });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.pool.stats() });

      expect(result.current.isSuccess).toBe(true);
      const txState = getRepaymentTxState();
      expect(txState?.status).toBe("confirmed");
      expect(txState?.progress).toBe(100);
      expect(txState?.txHash).toBe(TX_HASH);
    });
  });

  describe("failure paths", () => {
    it("surfaces a rejected wallet signature without submitting to the network", async () => {
      const declineError = new Error("User declined the transaction in Freighter.");
      const onError = jest.fn();
      mockSignTransaction.mockRejectedValue(declineError);
      const { result } = createTestHarness({ onError });

      let attempt: Promise<RepaymentResult> | undefined;
      act(() => {
        attempt = result.current.executeRepayment(LOAN);
      });
      const declined = expect(attempt).rejects.toThrow(
        "User declined the transaction in Freighter.",
      );
      await act(async () => {
        await declined;
      });

      expect(submitLoanTransaction).not.toHaveBeenCalled();
      expect(result.current.error).toBe("User declined the transaction in Freighter.");
      expect(result.current.isError).toBe(true);
      expect(getRepaymentTxState()?.status).toBe("failed");
      expect(onError).toHaveBeenCalledWith(declineError);
    });

    it("fails with a timeout error when the wallet never responds", async () => {
      jest.useFakeTimers();
      try {
        mockSignTransaction.mockImplementation(
          () =>
            new Promise<never>((_, reject) => {
              setTimeout(() => reject(new Error("Wallet signing timed out.")), 30_000);
            }),
        );
        const onError = jest.fn();
        const { result } = createTestHarness({ onError });

        let attempt: Promise<RepaymentResult> | undefined;
        act(() => {
          attempt = result.current.executeRepayment(LOAN);
        });
        // Attach the rejection expectation before the timer fires so the
        // rejection is never unhandled between the timer tick and the assert.
        const settled = expect(attempt).rejects.toThrow("Wallet signing timed out.");
        // Flush the build step, then fast-forward past the wallet timeout.
        await act(async () => {
          await jest.advanceTimersByTimeAsync(1);
          await jest.advanceTimersByTimeAsync(30_000);
        });

        await settled;
        expect(submitLoanTransaction).not.toHaveBeenCalled();
        expect(result.current.error).toBe("Wallet signing timed out.");
        expect(result.current.isError).toBe(true);
        expect(getRepaymentTxState()?.status).toBe("failed");
        expect(onError).toHaveBeenCalledWith(expect.any(Error));
      } finally {
        jest.useRealTimers();
      }
    });

    it("propagates a build failure before any signing or submission", async () => {
      mockBuildRepayment.mockRejectedValue(
        new Error("Repayment build failed: amount exceeds owed."),
      );
      const { result } = createTestHarness();

      let attempt: Promise<RepaymentResult> | undefined;
      act(() => {
        attempt = result.current.executeRepayment(LOAN);
      });
      const buildFailed = expect(attempt).rejects.toThrow(
        "Repayment build failed: amount exceeds owed.",
      );
      await act(async () => {
        await buildFailed;
      });

      expect(mockSignTransaction).not.toHaveBeenCalled();
      expect(submitLoanTransaction).not.toHaveBeenCalled();
      expect(result.current.error).toBe("Repayment build failed: amount exceeds owed.");
      expect(result.current.isError).toBe(true);
    });

    it("falls back to a generic message when a non-Error value is thrown", async () => {
      mockSignTransaction.mockRejectedValue("wallet exploded");
      const onError = jest.fn();
      const { result } = createTestHarness({ onError });

      let attempt: Promise<RepaymentResult> | undefined;
      act(() => {
        attempt = result.current.executeRepayment(LOAN);
      });
      const threwString = expect(attempt).rejects.toBe("wallet exploded");
      await act(async () => {
        await threwString;
      });

      expect(result.current.error).toBe("Repayment failed");
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Repayment failed" }),
      );
    });

    it("clearError resets the stored error message", async () => {
      mockSignTransaction.mockRejectedValue(new Error("User declined the transaction."));
      const { result } = createTestHarness();

      let attempt: Promise<RepaymentResult> | undefined;
      act(() => {
        attempt = result.current.executeRepayment(LOAN);
      });
      const declined = expect(attempt).rejects.toThrow("User declined the transaction.");
      await act(async () => {
        await declined;
      });
      expect(result.current.error).toBe("User declined the transaction.");

      act(() => {
        result.current.clearError();
      });
      expect(result.current.error).toBeNull();
    });
  });

  describe("retry state reset", () => {
    it("resets the in-flight guard and error state after a failure so a retry succeeds", async () => {
      mockSignTransaction
        .mockRejectedValueOnce(new Error("User declined the transaction."))
        .mockResolvedValueOnce(SIGNED_XDR);
      const { result } = createTestHarness();

      let firstAttempt: Promise<RepaymentResult> | undefined;
      act(() => {
        firstAttempt = result.current.executeRepayment(LOAN);
      });
      const declined = expect(firstAttempt).rejects.toThrow("User declined the transaction.");
      await act(async () => {
        await declined;
      });
      expect(result.current.error).toBe("User declined the transaction.");

      // Retry: must not hit the "already being processed" guard, must clear
      // the previous error, and must complete normally.
      let retry: Promise<RepaymentResult> | undefined;
      act(() => {
        retry = result.current.executeRepayment(LOAN);
      });
      const retried = expect(retry).resolves.toEqual({ txHash: TX_HASH, status: "success" });
      await act(async () => {
        await retried;
      });

      expect(mockBuildRepayment).toHaveBeenCalledTimes(2);
      expect(result.current.error).toBeNull();
      expect(result.current.isSuccess).toBe(true);
    });
  });

  describe("boundary path", () => {
    it("rejects a concurrent repayment while one is in flight, then recovers", async () => {
      const signDeferred = createDeferred<string>();
      mockSignTransaction.mockReturnValue(signDeferred.promise);
      const { result } = createTestHarness();

      let firstAttempt: Promise<RepaymentResult> | undefined;
      act(() => {
        firstAttempt = result.current.executeRepayment(LOAN);
      });

      await waitFor(() => expect(result.current.isSigning).toBe(true));
      const pendingState = getRepaymentTxState();
      expect(pendingState?.status).toBe("signing");
      expect(pendingState?.progress).toBe(40);

      await expect(result.current.executeRepayment(LOAN)).rejects.toThrow(
        "A repayment is already being processed.",
      );
      expect(mockBuildRepayment).toHaveBeenCalledTimes(1);
      expect(submitLoanTransaction).not.toHaveBeenCalled();

      mockSignTransaction.mockResolvedValue(SIGNED_XDR);
      await act(async () => {
        signDeferred.resolve(SIGNED_XDR);
        await expect(firstAttempt).resolves.toEqual({ txHash: TX_HASH, status: "success" });
      });
      expect(result.current.isSuccess).toBe(true);
    });
  });

  describe("authorization path", () => {
    it.each(["a non-success status", "a missing txHash"])(
      "rejects when the network response has %s",
      async (scenario) => {
        const submitResponse =
          scenario === "a non-success status"
            ? { txHash: TX_HASH, status: "FAILED" }
            : { status: "SUCCESS" };
        jest
          .mocked(submitLoanTransaction)
          .mockResolvedValue(
            submitResponse as unknown as Awaited<ReturnType<typeof submitLoanTransaction>>,
          );
        const onSuccess = jest.fn();
        const { result } = createTestHarness({ onSuccess });

        let attempt: Promise<RepaymentResult> | undefined;
        act(() => {
          attempt = result.current.executeRepayment(LOAN);
        });
        const unauthorized = expect(attempt).rejects.toThrow(
          "Stellar did not confirm the repayment transaction.",
        );
        await act(async () => {
          await unauthorized;
        });

        expect(submitLoanTransaction).toHaveBeenCalledWith(SIGNED_XDR);
        expect(onSuccess).not.toHaveBeenCalled();
        expect(result.current.error).toBe("Stellar did not confirm the repayment transaction.");
        expect(result.current.isError).toBe(true);
        expect(getRepaymentTxState()?.status).toBe("failed");
      },
    );
  });
});
