import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { jest } from "@jest/globals";

// The form reaches for the transaction preview, the on-chain repayment
// operation and two stores. Mock them so these tests exercise only the amount
// validation rule (#1810) and not the wallet/Soroban machinery around it.
const mockShow = jest.fn();

jest.mock("@/app/hooks/useTransactionPreview", () => ({
  useTransactionPreview: () => ({
    show: (...args: unknown[]) => mockShow(...args),
    close: jest.fn(),
  }),
}));

jest.mock("@/app/hooks/useRepaymentOperation", () => ({
  useRepaymentOperation: () => ({
    start: jest.fn(),
    updateProgress: jest.fn(),
    sign: jest.fn(),
    submit: jest.fn(),
    confirm: jest.fn(),
    complete: jest.fn(),
    fail: jest.fn(),
    executeRepayment: jest.fn().mockResolvedValue({ txHash: "abc" }),
    error: null,
    clearError: jest.fn(),
  }),
}));

jest.mock("@/app/stores/useGamificationStore", () => ({
  useGamificationStore: () => undefined,
}));

jest.mock("@/app/stores/useWalletStore", () => ({
  useWalletStore: jest.fn(() => undefined),
  selectWalletAddress: jest.fn(() => "GBD_BORROWER"),
}));

import { LoanRepaymentForm } from "../LoanRepaymentForm";

/**
 * A borrower whose remaining balance has fallen below the protocol minimum
 * payment must still be able to pay it off and close the loan (#1810).
 */
describe("LoanRepaymentForm payoff validation (#1810)", () => {
  const renderForm = (totalOwed: number, minPayment?: number) =>
    render(<LoanRepaymentForm loanId={42} totalOwed={totalOwed} minPayment={minPayment} />);

  const amountInput = () => screen.getByLabelText(/repayment amount/i);
  const submitButton = () => screen.getByRole("button", { name: /review repayment/i });

  const typeAndSubmit = (value: string) => {
    fireEvent.change(amountInput(), { target: { value } });
    fireEvent.click(submitButton());
  };

  it("allows paying off the full balance when it is below the minimum payment", () => {
    renderForm(12, 50);

    typeAndSubmit("12");

    expect(mockShow).toHaveBeenCalled();
    expect(screen.queryByText(/minimum payment is/i)).toBeNull();
  });

  it("rejects an amount below the remaining balance once below the minimum", () => {
    renderForm(12, 50);

    typeAndSubmit("5");

    expect(screen.getByText(/minimum payment is 12 usdc/i)).toBeTruthy();
    expect(mockShow).not.toHaveBeenCalled();
  });

  it("still enforces the protocol minimum while the balance is above it", () => {
    renderForm(400, 50);

    typeAndSubmit("10");

    expect(screen.getByText(/minimum payment is 50 usdc/i)).toBeTruthy();
    expect(mockShow).not.toHaveBeenCalled();
  });

  it("still rejects an amount above the total owed", () => {
    renderForm(400, 50);

    typeAndSubmit("500");

    expect(screen.getByText(/cannot exceed total owed/i)).toBeTruthy();
    expect(mockShow).not.toHaveBeenCalled();
  });

  it("permits a normal instalment when the balance is above the minimum", () => {
    renderForm(400, 50);

    typeAndSubmit("100");

    expect(mockShow).toHaveBeenCalled();
  });

  it("treats an exact-match balance as payable when equal to the minimum", () => {
    renderForm(50, 50);

    typeAndSubmit("50");

    expect(mockShow).toHaveBeenCalled();
  });

  it("does not apply any minimum when none is configured", () => {
    renderForm(12, 0);

    typeAndSubmit("12");

    expect(mockShow).toHaveBeenCalled();
  });

  it("still rejects a non-positive amount", () => {
    renderForm(400, 50);

    typeAndSubmit("0");

    expect(screen.getByText(/greater than 0/i)).toBeTruthy();
  });

  it("shows the payable minimum in the summary, not the unreachable one", () => {
    renderForm(12, 50);

    // The borrower must not be told a minimum they cannot possibly meet.
    expect(screen.getByText(/minimum payment \(payoff\)/i)).toBeTruthy();
    expect(screen.queryByText("50 USDC")).toBeNull();
  });

  it("shows the protocol minimum in the summary while the balance is above it", () => {
    renderForm(400, 50);

    expect(screen.getByText(/^Minimum Payment$/)).toBeTruthy();
    expect(screen.getByText("50 USDC")).toBeTruthy();
  });
});
