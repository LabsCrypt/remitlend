import { describe, expect, it } from "vitest";
import { formatLoanRepayment } from "./transactionFormatter";

describe("formatLoanRepayment", () => {
  it("formats repayment as a USDC debit", () => {
    const preview = formatLoanRepayment({ loanId: 42, amount: 125 });

    expect(preview.balanceChanges).toEqual([
      {
        token: "USDC",
        change: "-125",
        isPositive: false,
      },
    ]);
  });
});