/**
 * @jest-environment jsdom
 *
 * #1903 — StepFinalSignature interest calculation and sign/submit/poll state machine tests.
 *
 * Verifies:
 * 1. Interest and total repayment calculations across representative loan terms and amounts.
 * 2. Pre-building unsigned Soroban XDR and displaying loan recap metrics.
 * 3. Full state machine transitions: signing -> submitting -> polling -> success.
 * 4. Cancellation paths (user abort, polling cancelled, user rejected signing).
 * 5. Failure / error paths (wallet rejection, submission network error, on-chain revert, XDR build error).
 */

import React from "react";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const buildUnsignedLoanRequestXdr = jest.fn();
const signTransaction = jest.fn();
const submitLoanTransaction = jest.fn();
const pollTransactionStatus = jest.fn();
const toastShowPending = jest.fn(() => "toast-id-999");
const toastShowSuccess = jest.fn();
const toastShowError = jest.fn();
const toastSuccess = jest.fn();
const toastError = jest.fn();

let previewConfirm: (() => Promise<void>) | null = null;
const previewShow = jest.fn((_data: unknown, onConfirm: () => Promise<void>) => {
  previewConfirm = onConfirm;
});
const onSuccess = jest.fn();

jest.mock("../../../utils/soroban", () => ({
  buildUnsignedLoanRequestXdr: (...args: unknown[]) => buildUnsignedLoanRequestXdr(...(args as [])),
  getNetworkPassphrase: jest.fn(() => "Test SDF Network ; September 2015"),
}));

jest.mock("../../../hooks/useApi", () => ({
  submitLoanTransaction: (...args: unknown[]) => submitLoanTransaction(...(args as [])),
  queryKeys: {
    loans: {
      all: () => ["loans"],
      borrowerPagePrefix: (address: string) => ["loans", "borrower", address],
    },
  },
}));

jest.mock("../../providers/WalletProvider", () => ({
  useWallet: () => ({
    signTransaction: (...args: unknown[]) => signTransaction(...(args as [])),
    connectWallet: jest.fn(),
    disconnectWallet: jest.fn(),
    refreshWallet: jest.fn(),
    isFreighterAvailable: true,
  }),
}));

jest.mock("../../../hooks/useTransactionPreview", () => ({
  useTransactionPreview: () => ({
    show: (...args: unknown[]) => previewShow(...(args as [])),
    close: jest.fn(),
    confirm: jest.fn(),
    isOpen: false,
    isLoading: false,
    data: null,
  }),
}));

jest.mock("../../../hooks/useContractToast", () => ({
  useContractToast: () => ({
    showPending: (...args: unknown[]) => toastShowPending(...(args as [])),
    showSuccess: (...args: unknown[]) => toastShowSuccess(...(args as [])),
    showError: (...args: unknown[]) => toastShowError(...(args as [])),
    success: (...args: unknown[]) => toastSuccess(...(args as [])),
    error: (...args: unknown[]) => toastError(...(args as [])),
    info: jest.fn(),
    warning: jest.fn(),
    getStellarExpertUrl: jest.fn(),
  }),
}));

let mockMapTransactionError = (reason: unknown) => ({
  cancelledByUser: false,
  title: "Transaction failed",
  message: String(reason),
  guidance: "Try again.",
  retryable: true,
});

jest.mock("../../../utils/transactionErrors", () => ({
  mapTransactionError: (reason: unknown) => mockMapTransactionError(reason),
  pollTransactionStatus: (...args: unknown[]) => pollTransactionStatus(...(args as [])),
}));

import {
  StepFinalSignature,
  calculateEstimatedInterest,
  calculateTotalRepayment,
  ANNUAL_RATE_PERCENT,
} from "../StepFinalSignature";

const WIZARD_DATA = {
  amount: "1000",
  asset: "USDC",
  termDays: 30,
  collateralConfirmed: true,
  creditScore: 720,
  maxAmount: 5000,
} as never;

function renderStep(customData = WIZARD_DATA) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <StepFinalSignature
        data={customData}
        borrowerAddress="GBD_BORROWER_TEST_123"
        onBack={jest.fn()}
        onSuccess={onSuccess}
      />
    </QueryClientProvider>,
  );
}

/** Reviews the preview, then confirms it to drive the state machine (mimics useTransactionPreview.confirm error handling). */
async function confirmSubmission() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /sign & submit/i }));
    await Promise.resolve();
  });
  expect(previewConfirm).not.toBeNull();
  await act(async () => {
    try {
      await previewConfirm?.();
    } catch {
      // Mirrors useTransactionPreview.confirm's internal try/catch
    }
    await Promise.resolve();
  });
}

describe("StepFinalSignature (#1903)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    previewConfirm = null;
    process.env.NEXT_PUBLIC_MANAGER_CONTRACT_ID = "C_CONTRACT_123";
    buildUnsignedLoanRequestXdr.mockResolvedValue("unsigned-soroban-xdr");
    signTransaction.mockResolvedValue("signed-soroban-xdr");
    submitLoanTransaction.mockResolvedValue({ status: "SUCCESS", txHash: "tx-hash-final" });
    pollTransactionStatus.mockResolvedValue({ status: "success", message: "confirmed on-chain" });
    toastShowPending.mockReturnValue("toast-id-999");
    mockMapTransactionError = (reason: unknown) => ({
      cancelledByUser: false,
      title: "Transaction failed",
      message: String(reason),
      guidance: "Try again.",
      retryable: true,
    });
  });

  describe("Interest & Total Repayment Calculations", () => {
    it("exports ANNUAL_RATE_PERCENT as 12", () => {
      expect(ANNUAL_RATE_PERCENT).toBe(12);
    });

    it("calculates estimated interest for representative inputs", () => {
      // 1000 USDC for 30 days: (1000 * 12 * 30) / (365 * 100) = 9.863013698...
      const interest30 = calculateEstimatedInterest(1000, 30);
      expect(interest30).toBeCloseTo(9.863, 3);

      // 5000 USDC for 60 days: (5000 * 12 * 60) / 36500 = 98.6301...
      const interest60 = calculateEstimatedInterest(5000, 60);
      expect(interest60).toBeCloseTo(98.63, 2);

      // 10000 USDC for 365 days: (10000 * 12 * 365) / 36500 = 1200
      const interest365 = calculateEstimatedInterest(10000, 365);
      expect(interest365).toBe(1200);

      // 500 USDC for 15 days: (500 * 12 * 15) / 36500 = 2.4657...
      const interest15 = calculateEstimatedInterest(500, 15);
      expect(interest15).toBeCloseTo(2.466, 3);

      // Boundary: 0 principal
      expect(calculateEstimatedInterest(0, 30)).toBe(0);
    });

    it("calculates total repayment as principal + estimated interest", () => {
      const total30 = calculateTotalRepayment(1000, 30);
      expect(total30).toBeCloseTo(1009.863, 3);

      const total60 = calculateTotalRepayment(5000, 60);
      expect(total60).toBeCloseTo(5098.63, 2);

      const total365 = calculateTotalRepayment(10000, 365);
      expect(total365).toBe(11200);
    });

    it("renders formatted loan summary metrics in the UI", async () => {
      renderStep();
      await waitFor(() => expect(buildUnsignedLoanRequestXdr).toHaveBeenCalled());

      // Loan summary labels and values
      expect(screen.getByText("Loan Summary")).toBeInTheDocument();
      expect(screen.getByText("$1,000.00")).toBeInTheDocument(); // Principal
      expect(screen.getByText("30 days")).toBeInTheDocument(); // Term
      expect(screen.getByText("12%")).toBeInTheDocument(); // APR
      expect(screen.getByText("$9.86")).toBeInTheDocument(); // Estimated Interest
      expect(screen.getByText("$1,009.86")).toBeInTheDocument(); // Total Repayment
    });
  });

  describe("State Machine Lifecycle & Transitions", () => {
    it("initializes in idle state where tracker is hidden until submission begins", async () => {
      renderStep();

      // In idle state, TransactionStatusTracker returns null
      expect(screen.queryByRole("region")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /sign & submit/i })).toBeInTheDocument();

      await waitFor(() => {
        expect(buildUnsignedLoanRequestXdr).toHaveBeenCalledWith(
          expect.objectContaining({
            borrower: "GBD_BORROWER_TEST_123",
            amount: 1000,
            term: 30 * 17280,
          }),
        );
      });
    });

    it("executes full happy path transitions: signing -> submitting -> polling -> success", async () => {
      renderStep();
      await waitFor(() => expect(buildUnsignedLoanRequestXdr).toHaveBeenCalled());

      await confirmSubmission();

      // Verify signTransaction was called
      expect(signTransaction).toHaveBeenCalledWith("unsigned-soroban-xdr");

      // Verify submitLoanTransaction was called
      expect(submitLoanTransaction).toHaveBeenCalledWith("signed-soroban-xdr");

      // Verify polling was initiated
      expect(pollTransactionStatus).toHaveBeenCalledWith("tx-hash-final", expect.anything());

      // Verify final success state
      await waitFor(() => {
        expect(screen.getByText("Transaction confirmed")).toBeInTheDocument();
        expect(screen.getByText("Your loan request is confirmed on-chain.")).toBeInTheDocument();
      });

      expect(toastShowSuccess).toHaveBeenCalledWith("toast-id-999", {
        successMessage: "Loan request confirmed on-chain",
        txHash: "tx-hash-final",
      });
      expect(onSuccess).toHaveBeenCalledWith("tx-hash-final");
    });

    it("transitions to cancelled state when polling returns cancelled status", async () => {
      pollTransactionStatus.mockResolvedValue({
        status: "cancelled",
        message: "Polling status check was cancelled",
      });

      renderStep();
      await waitFor(() => expect(buildUnsignedLoanRequestXdr).toHaveBeenCalled());

      await confirmSubmission();

      await waitFor(() => {
        expect(screen.getByText("Status tracking cancelled")).toBeInTheDocument();
        expect(screen.getByText("Polling status check was cancelled")).toBeInTheDocument();
      });
      expect(onSuccess).not.toHaveBeenCalled();
    });

    it("transitions to cancelled state when wallet signing is rejected by user", async () => {
      mockMapTransactionError = () => ({
        cancelledByUser: true,
        title: "Signature cancelled",
        message: "User declined Freighter signing request.",
        guidance: "You can retry when ready.",
        retryable: true,
      });
      signTransaction.mockRejectedValue(new Error("User cancelled"));

      renderStep();
      await waitFor(() => expect(buildUnsignedLoanRequestXdr).toHaveBeenCalled());

      await confirmSubmission();

      await waitFor(() => {
        expect(screen.getByText("Signature cancelled")).toBeInTheDocument();
        expect(screen.getByText("User declined Freighter signing request.")).toBeInTheDocument();
      });

      expect(submitLoanTransaction).not.toHaveBeenCalled();
      expect(onSuccess).not.toHaveBeenCalled();
    });

    it("transitions to error state when on-chain transaction fails", async () => {
      pollTransactionStatus.mockResolvedValue({
        status: "failed",
        message: "Contract execution trapped: insufficient funds",
      });

      renderStep();
      await waitFor(() => expect(buildUnsignedLoanRequestXdr).toHaveBeenCalled());

      await confirmSubmission();

      await waitFor(() => {
        expect(screen.getByText("Transaction failed")).toBeInTheDocument();
        expect(
          screen.getByText("Contract execution trapped: insufficient funds"),
        ).toBeInTheDocument();
      });

      expect(toastShowError).toHaveBeenCalledWith(
        "toast-id-999",
        expect.objectContaining({ errorMessage: "Transaction failed" }),
      );
      expect(onSuccess).not.toHaveBeenCalled();
    });

    it("transitions to error state when network rejects submission", async () => {
      submitLoanTransaction.mockResolvedValue({
        status: "FAILED",
        txHash: "failed-hash",
      });

      renderStep();
      await waitFor(() => expect(buildUnsignedLoanRequestXdr).toHaveBeenCalled());

      await confirmSubmission();

      await waitFor(() => {
        expect(screen.getByText("Transaction failed")).toBeInTheDocument();
      });
      expect(toastShowError).toHaveBeenCalled();
      expect(onSuccess).not.toHaveBeenCalled();
    });

    it("displays error banner when XDR building fails", async () => {
      buildUnsignedLoanRequestXdr.mockRejectedValue(new Error("Soroban RPC connection refused"));

      renderStep();

      await waitFor(() => {
        expect(
          screen.getByText(
            /Soroban RPC connection refused \(XDR preview unavailable — you may still proceed\)/i,
          ),
        ).toBeInTheDocument();
      });

      expect(signTransaction).not.toHaveBeenCalled();
    });
  });
});
