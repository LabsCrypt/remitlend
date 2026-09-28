import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ExtensionLoanModal } from "../ExtensionLoanModal";
import { RefinanceLoanModal } from "../RefinanceLoanModal";
import { useWalletStore } from "../../../stores/useWalletStore";

const mockSignTransaction = jest.fn();
jest.mock("@stellar/freighter-api", () => ({
  signTransaction: (...args: unknown[]) => mockSignTransaction(...args),
}));

const mockBuildExtendLoanTransaction = jest.fn();
const mockBuildRefinanceLoanTransaction = jest.fn();
const mockSubmitLoanTransaction = jest.fn();
const mockUseLoanAmortizationPreview = jest.fn();

jest.mock("../../../hooks/useApi", () => ({
  buildExtendLoanTransaction: (...args: unknown[]) => mockBuildExtendLoanTransaction(...args),
  buildRefinanceLoanTransaction: (...args: unknown[]) => mockBuildRefinanceLoanTransaction(...args),
  submitLoanTransaction: (...args: unknown[]) => mockSubmitLoanTransaction(...args),
  useLoanAmortizationPreview: (...args: unknown[]) => mockUseLoanAmortizationPreview(...args),
}));

const mockToast = {
  showPending: jest.fn(() => "toast-id-123"),
  showSuccess: jest.fn(),
  showError: jest.fn(),
  error: jest.fn(),
  success: jest.fn(),
};

jest.mock("../../../hooks/useContractToast", () => ({
  useContractToast: () => mockToast,
}));

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe("LoanActionModals confirmation preview step (#1886)", () => {
  const defaultOnClose = jest.fn();
  const defaultOnSuccess = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    useWalletStore.setState({
      status: "connected",
      address: "GBD_BORROWER_TEST_123",
    });

    mockBuildExtendLoanTransaction.mockResolvedValue({
      unsignedTxXdr: "unsigned-extend-xdr",
      networkPassphrase: "Test SDF Network ; September 2015",
    });

    mockBuildRefinanceLoanTransaction.mockResolvedValue({
      unsignedTxXdr: "unsigned-refinance-xdr",
      networkPassphrase: "Test SDF Network ; September 2015",
    });

    mockSignTransaction.mockResolvedValue({
      signedTxXdr: "signed-tx-xdr",
    });

    mockSubmitLoanTransaction.mockResolvedValue({
      status: "SUCCESS",
      txHash: "0xhash123",
    });

    mockUseLoanAmortizationPreview.mockReturnValue({
      data: {
        estimatedApr: 8.5,
        totalRepayment: 1085,
        schedule: [],
      },
      isLoading: false,
      isError: false,
    });
  });

  describe("ExtensionLoanModal", () => {
    function renderExtension(props = {}) {
      return renderWithClient(
        <ExtensionLoanModal
          isOpen={true}
          onClose={defaultOnClose}
          onSuccess={defaultOnSuccess}
          loanId="loan-1"
          currentDueDate="2026-10-01T00:00:00Z"
          title="Extend Loan Term"
          submitLabel="Request Extension"
          cancelLabel="Cancel"
          ledgersLabel="Extra Ledgers"
          newDueDateLabel="New Due Date"
          busyLabel="Submitting..."
          {...props}
        />,
      );
    }

    it("opens TransactionPreviewModal on submit without immediately signing", async () => {
      renderExtension();

      const submitBtn = screen.getByRole("button", { name: "Request Extension" });
      fireEvent.click(submitBtn);

      // Review Transaction modal should open
      await waitFor(() => {
        expect(screen.getByText("Review Transaction")).toBeInTheDocument();
      });
      expect(screen.getByText(/Extend loan #loan-1 by 17280 ledgers/)).toBeInTheDocument();

      // Crucial: wallet signing must NOT have been called yet
      expect(mockSignTransaction).not.toHaveBeenCalled();
      expect(mockBuildExtendLoanTransaction).not.toHaveBeenCalled();
    });

    it("cancels out of the preview without signing anything", async () => {
      renderExtension();

      // Open preview
      fireEvent.click(screen.getByRole("button", { name: "Request Extension" }));
      await waitFor(() => {
        expect(screen.getByText("Review Transaction")).toBeInTheDocument();
      });

      // Find the Cancel button inside the preview modal
      const previewCancelButtons = screen.getAllByRole("button", { name: "Cancel" });
      // The last one is inside the preview modal
      fireEvent.click(previewCancelButtons[previewCancelButtons.length - 1]);

      // Verify signTransaction was NEVER called
      expect(mockSignTransaction).not.toHaveBeenCalled();
      expect(mockSubmitLoanTransaction).not.toHaveBeenCalled();
      expect(defaultOnSuccess).not.toHaveBeenCalled();
    });

    it("acknowledges and confirms preview, executing build, sign, and submit", async () => {
      renderExtension();

      // Open preview
      fireEvent.click(screen.getByRole("button", { name: "Request Extension" }));
      await waitFor(() => {
        expect(screen.getByText("Review Transaction")).toBeInTheDocument();
      });

      // Acknowledge checkbox in preview
      const checkbox = screen.getByRole("checkbox");
      fireEvent.click(checkbox);

      // Click Sign Transaction in preview
      const signBtn = screen.getByRole("button", { name: /sign transaction/i });
      fireEvent.click(signBtn);

      await waitFor(() => {
        expect(mockBuildExtendLoanTransaction).toHaveBeenCalledWith({
          loanId: "loan-1",
          borrowerPublicKey: "GBD_BORROWER_TEST_123",
          extraLedgers: 17280,
        });
      });

      expect(mockSignTransaction).toHaveBeenCalledWith("unsigned-extend-xdr", {
        networkPassphrase: "Test SDF Network ; September 2015",
      });
      expect(mockSubmitLoanTransaction).toHaveBeenCalledWith("signed-tx-xdr");
      expect(mockToast.showSuccess).toHaveBeenCalledWith("toast-id-123", {
        successMessage: "Extension request confirmed",
        txHash: "0xhash123",
      });
      expect(defaultOnSuccess).toHaveBeenCalled();
      expect(defaultOnClose).toHaveBeenCalled();
    });

    it("disables submit button if wallet is disconnected", async () => {
      useWalletStore.setState({
        status: "disconnected",
        address: null,
      });

      renderExtension();

      const submitBtn = screen.getByRole("button", { name: "Request Extension" });
      expect(submitBtn).toBeDisabled();
      expect(screen.queryByText("Review Transaction")).not.toBeInTheDocument();
      expect(mockSignTransaction).not.toHaveBeenCalled();
    });

    it("validates positive extra ledgers and shows toast error on invalid input", async () => {
      renderExtension();

      const input = screen.getByLabelText("Extra Ledgers");
      fireEvent.change(input, { target: { value: "0" } });

      const submitBtn = screen.getByRole("button", { name: "Request Extension" });
      fireEvent.click(submitBtn);

      expect(mockToast.error).toHaveBeenCalledWith(
        "Invalid extension",
        "Extra ledgers must be a positive number.",
      );
      expect(screen.queryByText("Review Transaction")).not.toBeInTheDocument();
      expect(mockSignTransaction).not.toHaveBeenCalled();
    });
  });

  describe("RefinanceLoanModal", () => {
    function renderRefinance(props = {}) {
      return renderWithClient(
        <RefinanceLoanModal
          isOpen={true}
          onClose={defaultOnClose}
          onSuccess={defaultOnSuccess}
          loanId="loan-2"
          currentPrincipal={1000}
          currentInterestRate={5}
          title="Refinance Loan"
          submitLabel="Submit Refinance"
          cancelLabel="Cancel"
          principalLabel="New Principal Amount"
          interestRateLabel="Interest Rate (%)"
          termLabel="Select Term"
          previewTitle="Repayment Preview"
          previewDescription="Estimated schedule"
          busyLabel="Submitting..."
          {...props}
        />,
      );
    }

    it("opens TransactionPreviewModal on submit without immediately signing", async () => {
      renderRefinance();

      const submitBtn = screen.getByRole("button", { name: "Submit Refinance" });
      fireEvent.click(submitBtn);

      // Review Transaction modal should open
      await waitFor(() => {
        expect(screen.getByText("Review Transaction")).toBeInTheDocument();
      });
      expect(screen.getByText(/Refinance loan #loan-2 to \$1000 for 30 days/)).toBeInTheDocument();

      // Crucial: wallet signing must NOT have been called yet
      expect(mockSignTransaction).not.toHaveBeenCalled();
      expect(mockBuildRefinanceLoanTransaction).not.toHaveBeenCalled();
    });

    it("cancels out of the preview without signing anything", async () => {
      renderRefinance();

      // Open preview
      fireEvent.click(screen.getByRole("button", { name: "Submit Refinance" }));
      await waitFor(() => {
        expect(screen.getByText("Review Transaction")).toBeInTheDocument();
      });

      // Find the Cancel button inside the preview modal
      const previewCancelButtons = screen.getAllByRole("button", { name: "Cancel" });
      fireEvent.click(previewCancelButtons[previewCancelButtons.length - 1]);

      // Verify signTransaction was NEVER called
      expect(mockSignTransaction).not.toHaveBeenCalled();
      expect(mockSubmitLoanTransaction).not.toHaveBeenCalled();
      expect(defaultOnSuccess).not.toHaveBeenCalled();
    });

    it("acknowledges and confirms preview, executing build, sign, and submit", async () => {
      renderRefinance();

      // Open preview
      fireEvent.click(screen.getByRole("button", { name: "Submit Refinance" }));
      await waitFor(() => {
        expect(screen.getByText("Review Transaction")).toBeInTheDocument();
      });

      // Acknowledge checkbox in preview
      const checkbox = screen.getByRole("checkbox");
      fireEvent.click(checkbox);

      // Click Sign Transaction in preview
      const signBtn = screen.getByRole("button", { name: /sign transaction/i });
      fireEvent.click(signBtn);

      await waitFor(() => {
        expect(mockBuildRefinanceLoanTransaction).toHaveBeenCalledWith({
          loanId: "loan-2",
          borrowerPublicKey: "GBD_BORROWER_TEST_123",
          newAmount: 1000,
          newTerm: 30 * 17280,
        });
      });

      expect(mockSignTransaction).toHaveBeenCalledWith("unsigned-refinance-xdr", {
        networkPassphrase: "Test SDF Network ; September 2015",
      });
      expect(mockSubmitLoanTransaction).toHaveBeenCalledWith("signed-tx-xdr");
      expect(mockToast.showSuccess).toHaveBeenCalledWith("toast-id-123", {
        successMessage: "Refinance transaction confirmed",
        txHash: "0xhash123",
      });
      expect(defaultOnSuccess).toHaveBeenCalled();
      expect(defaultOnClose).toHaveBeenCalled();
    });

    it("disables submit button if wallet is disconnected", async () => {
      useWalletStore.setState({
        status: "disconnected",
        address: null,
      });

      renderRefinance();

      const submitBtn = screen.getByRole("button", { name: "Submit Refinance" });
      expect(submitBtn).toBeDisabled();
      expect(screen.queryByText("Review Transaction")).not.toBeInTheDocument();
      expect(mockSignTransaction).not.toHaveBeenCalled();
    });

    it("validates positive principal and shows toast error on invalid input", async () => {
      renderRefinance();

      const input = screen.getByLabelText("New Principal Amount");
      fireEvent.change(input, { target: { value: "0" } });

      const submitBtn = screen.getByRole("button", { name: "Submit Refinance" });
      fireEvent.click(submitBtn);

      expect(mockToast.error).toHaveBeenCalledWith(
        "Invalid amount",
        "Enter a valid principal amount.",
      );
      expect(screen.queryByText("Review Transaction")).not.toBeInTheDocument();
      expect(mockSignTransaction).not.toHaveBeenCalled();
    });
  });
});
