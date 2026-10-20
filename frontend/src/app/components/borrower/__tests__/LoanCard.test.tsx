import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import type { BorrowerLoan } from "../../../hooks/useApi";

const mockPush = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    replace: jest.fn(),
    refresh: jest.fn(),
  }),
}));

import { LoanCard } from "../LoanCard";

describe("LoanCard overdue and urgency badge classification (#1887)", () => {
  const baseNow = new Date("2026-09-28T12:00:00.000Z").getTime();

  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(baseNow);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  const baseLoan: BorrowerLoan = {
    id: 101,
    principal: 5000,
    accruedInterest: 150,
    totalOwed: 5150,
    totalRepaid: 1000,
    nextPaymentDeadline: new Date(baseNow + 5 * 24 * 60 * 60 * 1000).toISOString(),
    status: "active",
    borrower: "GBD_BORROWER_1",
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("correctly classifies loan overdue by less than 24 hours (< 24h) as Overdue", () => {
    // 5 hours in the past
    const fiveHoursOverdue = new Date(baseNow - 5 * 60 * 60 * 1000).toISOString();
    const loan: BorrowerLoan = {
      ...baseLoan,
      nextPaymentDeadline: fiveHoursOverdue,
    };

    render(<LoanCard loan={loan} variant="detailed" />);

    // Urgency badge should be "Overdue", NOT "Due Soon" or "On Track"
    expect(screen.getByText("Overdue")).toBeInTheDocument();
    expect(screen.queryByText("Due Soon")).not.toBeInTheDocument();
    expect(screen.queryByText("On Track")).not.toBeInTheDocument();

    // Deadline label should show 1 days overdue
    expect(screen.getByText("1 days overdue")).toBeInTheDocument();

    // Action button should indicate overdue payment
    const payButton = screen.getByRole("button", { name: /Pay Now \(Overdue\)/i });
    expect(payButton).toBeInTheDocument();

    fireEvent.click(payButton);
    expect(mockPush).toHaveBeenCalledWith("/repay/101");
  });

  it("correctly classifies loan overdue by multiple days as Overdue", () => {
    // 60 hours in the past (2.5 days overdue -> 3rd day overdue)
    const threeDaysOverdue = new Date(baseNow - (2 * 24 + 12) * 60 * 60 * 1000).toISOString();
    const loan: BorrowerLoan = {
      ...baseLoan,
      nextPaymentDeadline: threeDaysOverdue,
    };

    render(<LoanCard loan={loan} variant="detailed" />);

    expect(screen.getByText("Overdue")).toBeInTheDocument();
    expect(screen.getByText("3 days overdue")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Pay Now \(Overdue\)/i })).toBeInTheDocument();
  });

  it("classifies loan due within 7 days as Due Soon", () => {
    // 3 days in the future
    const threeDaysFuture = new Date(baseNow + 3 * 24 * 60 * 60 * 1000).toISOString();
    const loan: BorrowerLoan = {
      ...baseLoan,
      nextPaymentDeadline: threeDaysFuture,
    };

    render(<LoanCard loan={loan} variant="detailed" />);

    expect(screen.getByText("Due Soon")).toBeInTheDocument();
    expect(screen.queryByText("Overdue")).not.toBeInTheDocument();
    expect(screen.getByText("3 days remaining")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Repay Now" })).toBeInTheDocument();
  });

  it("classifies loan due after 7 days as On Track", () => {
    // 15 days in the future
    const fifteenDaysFuture = new Date(baseNow + 15 * 24 * 60 * 60 * 1000).toISOString();
    const loan: BorrowerLoan = {
      ...baseLoan,
      nextPaymentDeadline: fifteenDaysFuture,
    };

    render(<LoanCard loan={loan} variant="detailed" />);

    expect(screen.getByText("On Track")).toBeInTheDocument();
    expect(screen.queryByText("Overdue")).not.toBeInTheDocument();
    expect(screen.getByText("15 days remaining")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Repay Now" })).toBeInTheDocument();
  });

  it("renders compact variant without urgency badge but with correct overdue button", () => {
    const twoHoursOverdue = new Date(baseNow - 2 * 60 * 60 * 1000).toISOString();
    const loan: BorrowerLoan = {
      ...baseLoan,
      nextPaymentDeadline: twoHoursOverdue,
    };

    render(<LoanCard loan={loan} variant="compact" />);

    expect(screen.getByText("1 days overdue")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Pay Now \(Overdue\)/i })).toBeInTheDocument();
  });
});
