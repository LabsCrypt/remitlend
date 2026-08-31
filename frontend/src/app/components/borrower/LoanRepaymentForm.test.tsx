import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { LoanRepaymentForm } from "./LoanRepaymentForm";

/* ── Mocks ─────────────────────────────────────────────────────────────── */

jest.mock("../../hooks/useTransactionPreview", () => ({
  useTransactionPreview: jest.fn(() => ({
    isOpen: false,
    show: jest.fn(),
    close: jest.fn(),
    confirm: jest.fn(),
    data: null,
    isLoading: false,
  })),
}));

jest.mock("../../stores/useGamificationStore", () => ({
  useGamificationStore: jest.fn(() => ({
    addXP: jest.fn(),
    unlockAchievement: jest.fn(),
  })),
}));

jest.mock("../../hooks/useRepaymentOperation", () => ({
  useRepaymentOperation: jest.fn(() => ({
    executeRepayment: jest.fn(),
    isLoading: false,
    error: null,
    transaction: {},
  })),
}));

jest.mock("../../stores/useWalletStore", () => ({
  useWalletStore: jest.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({ address: "GTEST123ADDR" }),
  ),
  selectWalletAddress: (state: Record<string, unknown>) => state.address,
}));

jest.mock("../transaction/TransactionPreviewModal", () => ({
  TransactionPreviewModal: () => null,
}));

jest.mock("../ui/OperationProgress", () => ({
  OperationProgress: () => null,
}));

jest.mock("lucide-react", () => ({
  DollarSign: () => null,
  AlertCircle: () => null,
}));

/* ── Tests ─────────────────────────────────────────────────────────────── */

describe("LoanRepaymentForm – Pay Full Amount precision (#1488)", () => {
  const renderForm = (totalOwed: number, minPayment = 0) =>
    render(<LoanRepaymentForm loanId={1} totalOwed={totalOwed} minPayment={minPayment} />);

  it("fills a value that satisfies USDC precision when totalOwed has >2 decimals", () => {
    renderForm(123.456);

    fireEvent.click(screen.getByText(/Pay Full Amount/i));

    const input = screen.getByPlaceholderText("0.00") as HTMLInputElement;
    expect(input.value).not.toBe("");

    // No USDC precision error should appear
    expect(screen.queryByText(/supports at most/i)).not.toBeInTheDocument();

    // Submit button must be enabled
    const submitBtn = screen.getByRole("button", { name: /Review Repayment/i });
    expect(submitBtn).toBeEnabled();
  });

  it("formats totalOwed with exactly 2 decimal places for USDC", () => {
    renderForm(50.1);

    fireEvent.click(screen.getByText(/Pay Full Amount/i));

    const input = screen.getByPlaceholderText("0.00") as HTMLInputElement;
    // toFixed(2) turns 50.1 into "50.10", trailing zero stripped → "50.1"
    expect(input.value).toBe("50.1");
    expect(screen.queryByText(/supports at most/i)).not.toBeInTheDocument();
  });

  it("strips trailing zeros after formatting to asset decimals", () => {
    renderForm(200);

    fireEvent.click(screen.getByText(/Pay Full Amount/i));

    const input = screen.getByPlaceholderText("0.00") as HTMLInputElement;
    // toFixed(2) gives "200.00", replace strips trailing → "200"
    expect(input.value).toBe("200");
    expect(screen.queryByText(/supports at most/i)).not.toBeInTheDocument();
  });

  it("immediately submitting after Pay Full is not blocked by a precision error", () => {
    renderForm(1000.999);

    fireEvent.click(screen.getByText(/Pay Full Amount/i));

    const submitBtn = screen.getByRole("button", { name: /Review Repayment/i });
    expect(submitBtn).toBeEnabled();

    // Manually clicking submit should NOT produce a precision error
    fireEvent.click(submitBtn);

    expect(screen.queryByText(/supports at most/i)).not.toBeInTheDocument();
  });

  it("clears previous validation error when Pay Full is clicked", () => {
    renderForm(500);

    const input = screen.getByPlaceholderText("0.00") as HTMLInputElement;

    // Type "0" which passes sanitization but fails the >0 validation
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: /Review Repayment/i }));
    expect(screen.getByText(/Amount must be greater than 0/i)).toBeInTheDocument();

    // Click Pay Full Amount – should clear the error
    fireEvent.click(screen.getByText(/Pay Full Amount/i));
    expect(screen.queryByText(/Amount must be greater than 0/i)).not.toBeInTheDocument();

    const submitBtn = screen.getByRole("button", { name: /Review Repayment/i });
    expect(submitBtn).toBeEnabled();
  });

  it("totalOwed with many decimal places is truncated to 2 decimals", () => {
    renderForm(99.123456789);

    fireEvent.click(screen.getByText(/Pay Full Amount/i));

    const input = screen.getByPlaceholderText("0.00") as HTMLInputElement;
    // toFixed(2) truncates/rounds → "99.12"
    expect(input.value).toBe("99.12");
    expect(screen.queryByText(/supports at most/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Review Repayment/i })).toBeEnabled();
  });
});
