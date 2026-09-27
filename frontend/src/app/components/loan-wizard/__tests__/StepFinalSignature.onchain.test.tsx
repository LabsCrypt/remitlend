/**
 * #1811 — LoanApplicationWizard must sign and submit on-chain.
 *
 * The final step built an unsigned Soroban XDR and then called POST /loans
 * without ever asking the wallet to sign it. That endpoint is registered only
 * in test/development, so in production the request 404'd, and in development it
 * wrote dummy rows while nothing was ever submitted to Soroban.
 *
 * These tests pin the real lifecycle: sign the pre-built XDR, submit it, wait
 * for on-chain confirmation, and only then report success.
 */

import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const buildUnsignedLoanRequestXdr = jest.fn();
const signTransaction = jest.fn();
const submitLoanTransaction = jest.fn();
const pollTransactionStatus = jest.fn();
const toastShowPending = jest.fn(() => "toast-id");
const toastShowSuccess = jest.fn();
const toastShowError = jest.fn();
const toastSuccess = jest.fn();
// The real TransactionPreviewModal calls the second argument of show() when the
// user confirms, so the mock stores it and the test drives it explicitly.
let previewConfirm: (() => Promise<void>) | null = null;
const previewShow = jest.fn((_data: unknown, onConfirm: () => Promise<void>) => {
  previewConfirm = onConfirm;
});
const onSuccess = jest.fn();

jest.mock("../../utils/soroban", () => ({
  buildUnsignedLoanRequestXdr: (...args: unknown[]) =>
    buildUnsignedLoanRequestXdr(...(args as [])),
  getNetworkPassphrase: jest.fn(() => "Test SDF Network ; September 2015"),
}));

jest.mock("../../hooks/useApi", () => ({
  submitLoanTransaction: (...args: unknown[]) => submitLoanTransaction(...(args as [])),
  queryKeys: {
    loans: {
      all: () => ["loans"],
      borrowerPagePrefix: (address: string) => ["loans", "borrower", address],
    },
  },
}));

jest.mock("../providers/WalletProvider", () => ({
  useWallet: () => ({
    signTransaction: (...args: unknown[]) => signTransaction(...(args as [])),
    connectWallet: jest.fn(),
    disconnectWallet: jest.fn(),
    refreshWallet: jest.fn(),
    isFreighterAvailable: true,
  }),
}));

jest.mock("../../hooks/useTransactionPreview", () => ({
  useTransactionPreview: () => ({
    show: (...args: unknown[]) => previewShow(...(args as [unknown, () => Promise<void>])),
    close: jest.fn(),
    confirm: jest.fn(),
    // The modal is driven directly in these tests, so it never renders; the
    // component only needs these fields to exist.
    isOpen: false,
    isLoading: false,
    data: null,
  }),
}));

jest.mock("../../hooks/useContractToast", () => ({
  useContractToast: () => ({
    showPending: (...args: unknown[]) => toastShowPending(...(args as [])),
    showSuccess: (...args: unknown[]) => toastShowSuccess(...(args as [])),
    showError: (...args: unknown[]) => toastShowError(...(args as [])),
    success: (...args: unknown[]) => toastSuccess(...(args as [])),
    error: jest.fn(),
    info: jest.fn(),
    warning: jest.fn(),
    getStellarExpertUrl: jest.fn(),
  }),
}));

jest.mock("../../utils/transactionErrors", () => ({
  mapTransactionError: (reason: unknown) => ({
    cancelledByUser: false,
    title: "Transaction failed",
    message: String(reason),
    guidance: "Try again.",
    retryable: true,
  }),
  pollTransactionStatus: (...args: unknown[]) => pollTransactionStatus(...(args as [])),
}));

import { StepFinalSignature } from "../StepFinalSignature";

const WIZARD_DATA = {
  amount: "1000",
  asset: "USDC",
  termDays: 30,
  collateralConfirmed: true,
  creditScore: 720,
  maxAmount: 5000,
} as never;

function renderStep() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <StepFinalSignature
        data={WIZARD_DATA}
        borrowerAddress="GBD_BORROWER"
        onBack={jest.fn()}
        onSuccess={onSuccess}
      />
    </QueryClientProvider>,
  );
}

/** Reviews the preview, then confirms it — the two steps the UI requires. */
async function confirmSubmission() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /sign & submit/i }));
    await Promise.resolve();
  });
  expect(previewConfirm).not.toBeNull();
  await act(async () => {
    await previewConfirm?.();
    await Promise.resolve();
  });
}

describe("StepFinalSignature on-chain submission (#1811)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    previewConfirm = null;
    process.env.NEXT_PUBLIC_MANAGER_CONTRACT_ID = "C_CONTRACT";
    buildUnsignedLoanRequestXdr.mockResolvedValue("unsigned-xdr");
    signTransaction.mockResolvedValue("signed-xdr");
    submitLoanTransaction.mockResolvedValue({ status: "SUCCESS", txHash: "tx-hash-1" });
    pollTransactionStatus.mockResolvedValue({ status: "success", message: "confirmed" });
    toastShowPending.mockReturnValue("toast-id");
  });

  it("builds the unsigned XDR before submitting", async () => {
    renderStep();

    await waitFor(() => {
      expect(buildUnsignedLoanRequestXdr).toHaveBeenCalledWith(
        expect.objectContaining({ borrower: "GBD_BORROWER", amount: 1000 }),
      );
    });
  });

  it("asks the wallet to sign the pre-built XDR", async () => {
    renderStep();
    await waitFor(() => expect(buildUnsignedLoanRequestXdr).toHaveBeenCalled());

    await confirmSubmission();

    await waitFor(() => {
      expect(signTransaction).toHaveBeenCalledWith("unsigned-xdr");
    });
  });

  it("submits the signed XDR to the network", async () => {
    renderStep();
    await waitFor(() => expect(buildUnsignedLoanRequestXdr).toHaveBeenCalled());

    await confirmSubmission();

    await waitFor(() => {
      expect(submitLoanTransaction).toHaveBeenCalledWith("signed-xdr");
    });
  });

  it("never calls POST /loans — the test-only create endpoint", async () => {
    // The old flow hit apiFetch("/loans"), which is only registered in
    // test/development. Any call to it in this flow is the bug regressing.
    const globalFetch = global.fetch as jest.Mock | undefined;
    renderStep();
    await waitFor(() => expect(buildUnsignedLoanRequestXdr).toHaveBeenCalled());
    await confirmSubmission();

    const calledUrls = (globalFetch?.mock.calls ?? []).map(([url]) => String(url));
    expect(calledUrls.filter((url) => /\/loans$/.test(url))).toEqual([]);
  });

  it("polls for on-chain confirmation of the submitted transaction", async () => {
    renderStep();
    await waitFor(() => expect(buildUnsignedLoanRequestXdr).toHaveBeenCalled());

    await confirmSubmission();

    await waitFor(() => {
      expect(pollTransactionStatus).toHaveBeenCalledWith("tx-hash-1", expect.anything());
    });
  });

  it("reports success with the on-chain transaction hash once confirmed", async () => {
    renderStep();
    await waitFor(() => expect(buildUnsignedLoanRequestXdr).toHaveBeenCalled());

    await confirmSubmission();

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith("tx-hash-1");
    });
  });

  it("fails without submitting when the wallet returns no signature", async () => {
    signTransaction.mockRejectedValue(new Error("User rejected"));
    renderStep();
    await waitFor(() => expect(buildUnsignedLoanRequestXdr).toHaveBeenCalled());

    await confirmSubmission();

    await waitFor(() => {
      expect(toastShowError).toHaveBeenCalled();
    });
    // Nothing may reach the network without a signature.
    expect(submitLoanTransaction).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("fails when the network rejects the submission", async () => {
    submitLoanTransaction.mockResolvedValue({ status: "FAILED", txHash: "tx-hash-1" });
    renderStep();
    await waitFor(() => expect(buildUnsignedLoanRequestXdr).toHaveBeenCalled());

    await confirmSubmission();

    await waitFor(() => {
      expect(toastShowError).toHaveBeenCalled();
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("does not report success when polling says the transaction failed", async () => {
    pollTransactionStatus.mockResolvedValue({ status: "failed", message: "reverted" });
    renderStep();
    await waitFor(() => expect(buildUnsignedLoanRequestXdr).toHaveBeenCalled());

    await confirmSubmission();

    await waitFor(() => {
      expect(toastShowError).toHaveBeenCalled();
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("submits nothing when the XDR could not be built", async () => {
    buildUnsignedLoanRequestXdr.mockRejectedValue(new Error("build failed"));
    renderStep();

    await waitFor(() => {
      expect(screen.getByText(/failed to build unsigned xdr/i)).toBeTruthy();
    });
    expect(signTransaction).not.toHaveBeenCalled();
    expect(submitLoanTransaction).not.toHaveBeenCalled();
  });
});
