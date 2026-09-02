import {
  formatLoanRequest,
  formatLoanRepayment,
  formatDeposit,
  formatWithdraw,
  formatRemittanceSend,
  formatGenericTransaction,
} from "./transactionFormatter";

describe("transactionFormatter", () => {
  describe("formatLoanRequest", () => {
    it("returns correct operations with label and amount", () => {
      const result = formatLoanRequest({ amount: 5000, borrower: "GABC1234567890DEF" });

      expect(result.operations).toHaveLength(1);
      expect(result.operations[0].type).toBe("Request Loan");
      expect(result.operations[0].description).toBe("You are requesting a loan of 5000 USDC");
      expect(result.operations[0].amount).toBe("5000");
      expect(result.operations[0].token).toBe("USDC");
    });

    it("returns correct balance change with positive direction", () => {
      const result = formatLoanRequest({ amount: 5000, borrower: "GABC1234567890DEF" });

      expect(result.balanceChanges).toHaveLength(1);
      expect(result.balanceChanges[0].token).toBe("USDC");
      expect(result.balanceChanges[0].change).toBe("5000");
      expect(result.balanceChanges[0].isPositive).toBe(true);
    });

    it("formats amount correctly with decimal values", () => {
      const result = formatLoanRequest({ amount: 1234.56, borrower: "GABC1234567890DEF" });

      expect(result.operations[0].amount).toBe("1234.56");
      expect(result.balanceChanges[0].change).toBe("1234.56");
      expect(result.balanceChanges[0].isPositive).toBe(true);
    });

    it("includes borrower address and loan status in details", () => {
      const result = formatLoanRequest({ amount: 1000, borrower: "GABC1234567890DEF" });

      expect(result.operations[0].details).toEqual({
        "Borrower Address": "GABC1234...890DEF",
        "Loan Status": "Pending Approval",
      });
    });

    it("includes network and estimated gas fee", () => {
      const result = formatLoanRequest({ amount: 1000, borrower: "GABC1234567890DEF" });

      expect(result.network).toBe("Stellar Testnet");
      expect(result.estimatedGasFee).toBe("0.00001");
    });
  });

  describe("formatLoanRepayment", () => {
    it("returns correct operations with label and amount", () => {
      const result = formatLoanRepayment({ loanId: 42, amount: 2500 });

      expect(result.operations).toHaveLength(1);
      expect(result.operations[0].type).toBe("Repay Loan");
      expect(result.operations[0].description).toBe("You are repaying 2500 USDC for Loan #42");
      expect(result.operations[0].amount).toBe("2500");
      expect(result.operations[0].token).toBe("USDC");
    });

    it("returns correct balance change with negative direction", () => {
      const result = formatLoanRepayment({ loanId: 42, amount: 2500 });

      expect(result.balanceChanges).toHaveLength(1);
      expect(result.balanceChanges[0].token).toBe("USDC");
      expect(result.balanceChanges[0].change).toBe("-2500");
      expect(result.balanceChanges[0].isPositive).toBe(false);
    });

    it("formats amount correctly with decimal values", () => {
      const result = formatLoanRepayment({ loanId: 1, amount: 999.99 });

      expect(result.operations[0].amount).toBe("999.99");
      expect(result.balanceChanges[0].change).toBe("-999.99");
      expect(result.balanceChanges[0].isPositive).toBe(false);
    });

    it("includes loan ID and payment type in details", () => {
      const result = formatLoanRepayment({ loanId: 7, amount: 100 });

      expect(result.operations[0].details).toEqual({
        "Loan ID": "7",
        "Payment Type": "Principal + Interest",
      });
    });

    it("includes network and estimated gas fee", () => {
      const result = formatLoanRepayment({ loanId: 1, amount: 100 });

      expect(result.network).toBe("Stellar Testnet");
      expect(result.estimatedGasFee).toBe("0.00001");
    });
  });

  describe("formatDeposit", () => {
    it("returns correct operations with label and amount", () => {
      const result = formatDeposit({ amount: 1000, token: "USDC" });

      expect(result.operations).toHaveLength(1);
      expect(result.operations[0].type).toBe("Deposit");
      expect(result.operations[0].description).toBe(
        "You are depositing 1000 USDC into the lending pool",
      );
      expect(result.operations[0].amount).toBe("1000");
      expect(result.operations[0].token).toBe("USDC");
    });

    it("returns two balance changes with correct directions", () => {
      const result = formatDeposit({ amount: 1000, token: "USDC" });

      expect(result.balanceChanges).toHaveLength(2);

      expect(result.balanceChanges[0].token).toBe("USDC");
      expect(result.balanceChanges[0].change).toBe("-1000");
      expect(result.balanceChanges[0].isPositive).toBe(false);

      expect(result.balanceChanges[1].token).toBe("LP-USDC");
      expect(result.balanceChanges[1].change).toBe("1000");
      expect(result.balanceChanges[1].isPositive).toBe(true);
    });

    it("formats amount correctly with decimal values for both balance changes", () => {
      const result = formatDeposit({ amount: 500.75, token: "EURC" });

      expect(result.operations[0].amount).toBe("500.75");
      expect(result.balanceChanges[0].change).toBe("-500.75");
      expect(result.balanceChanges[0].isPositive).toBe(false);
      expect(result.balanceChanges[1].change).toBe("500.75");
      expect(result.balanceChanges[1].isPositive).toBe(true);
    });

    it("includes pool type and expected yield in details", () => {
      const result = formatDeposit({ amount: 100, token: "PHP" });

      expect(result.operations[0].details).toEqual({
        "Pool Type": "Lending Pool",
        "Expected Yield": "~8-12% APY",
      });
    });

    it("uses token parameter for LP token naming", () => {
      const result = formatDeposit({ amount: 100, token: "XLM" });

      expect(result.balanceChanges[1].token).toBe("LP-XLM");
    });

    it("includes network and estimated gas fee", () => {
      const result = formatDeposit({ amount: 100, token: "USDC" });

      expect(result.network).toBe("Stellar Testnet");
      expect(result.estimatedGasFee).toBe("0.00001");
    });
  });

  describe("formatWithdraw", () => {
    it("returns correct operations with label and amount", () => {
      const result = formatWithdraw({ amount: 1000, token: "USDC" });

      expect(result.operations).toHaveLength(1);
      expect(result.operations[0].type).toBe("Withdraw");
      expect(result.operations[0].description).toBe(
        "You are withdrawing 1000 USDC from the lending pool",
      );
      expect(result.operations[0].amount).toBe("1000");
      expect(result.operations[0].token).toBe("USDC");
    });

    it("returns two balance changes with correct directions", () => {
      const result = formatWithdraw({ amount: 1000, token: "USDC" });

      expect(result.balanceChanges).toHaveLength(2);

      expect(result.balanceChanges[0].token).toBe("LP-USDC");
      expect(result.balanceChanges[0].change).toBe("-1000");
      expect(result.balanceChanges[0].isPositive).toBe(false);

      expect(result.balanceChanges[1].token).toBe("USDC");
      expect(result.balanceChanges[1].change).toBe("1000");
      expect(result.balanceChanges[1].isPositive).toBe(true);
    });

    it("formats amount correctly with decimal values for both balance changes", () => {
      const result = formatWithdraw({ amount: 250.25, token: "EURC" });

      expect(result.operations[0].amount).toBe("250.25");
      expect(result.balanceChanges[0].change).toBe("-250.25");
      expect(result.balanceChanges[0].isPositive).toBe(false);
      expect(result.balanceChanges[1].change).toBe("250.25");
      expect(result.balanceChanges[1].isPositive).toBe(true);
    });

    it("includes pool type and withdrawal type in details", () => {
      const result = formatWithdraw({ amount: 100, token: "PHP" });

      expect(result.operations[0].details).toEqual({
        "Pool Type": "Lending Pool",
        "Withdrawal Type": "Full Amount + Earned Interest",
      });
    });

    it("uses token parameter for LP token naming", () => {
      const result = formatWithdraw({ amount: 100, token: "XLM" });

      expect(result.balanceChanges[0].token).toBe("LP-XLM");
    });

    it("includes network and estimated gas fee", () => {
      const result = formatWithdraw({ amount: 100, token: "USDC" });

      expect(result.network).toBe("Stellar Testnet");
      expect(result.estimatedGasFee).toBe("0.00001");
    });
  });

  describe("formatRemittanceSend", () => {
    it("returns correct operations with label and amount", () => {
      const result = formatRemittanceSend({
        amount: 500,
        recipient: "GABC1234567890DEF",
        token: "USDC",
      });

      expect(result.operations).toHaveLength(1);
      expect(result.operations[0].type).toBe("Send Remittance");
      expect(result.operations[0].description).toBe(
        "You are sending 500 USDC to GABC1234...890DEF",
      );
      expect(result.operations[0].amount).toBe("500");
      expect(result.operations[0].token).toBe("USDC");
    });

    it("returns correct balance change with negative direction", () => {
      const result = formatRemittanceSend({
        amount: 500,
        recipient: "GABC1234567890DEF",
        token: "USDC",
      });

      expect(result.balanceChanges).toHaveLength(1);
      expect(result.balanceChanges[0].token).toBe("USDC");
      expect(result.balanceChanges[0].change).toBe("-500");
      expect(result.balanceChanges[0].isPositive).toBe(false);
    });

    it("formats amount correctly with decimal values", () => {
      const result = formatRemittanceSend({
        amount: 123.45,
        recipient: "GABC1234567890DEF",
        token: "EURC",
      });

      expect(result.operations[0].amount).toBe("123.45");
      expect(result.balanceChanges[0].change).toBe("-123.45");
      expect(result.balanceChanges[0].isPositive).toBe(false);
    });

    it("includes recipient, transfer type, and credit score impact in details", () => {
      const result = formatRemittanceSend({
        amount: 100,
        recipient: "GABC1234567890DEF",
        token: "PHP",
      });

      expect(result.operations[0].details).toEqual({
        Recipient: "GABC1234...890DEF",
        "Transfer Type": "Cross-border Remittance",
        "Credit Score Impact": "+5 points",
      });
    });

    it("masks recipient address correctly", () => {
      const result = formatRemittanceSend({
        amount: 100,
        recipient: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        token: "USDC",
      });

      expect(result.operations[0].description).toContain("GBBBBBBB...BBBBBB");
      expect(result.operations[0].details?.Recipient).toBe("GBBBBBBB...BBBBBB");
    });

    it("includes network and estimated gas fee", () => {
      const result = formatRemittanceSend({
        amount: 100,
        recipient: "GABC1234567890DEF",
        token: "USDC",
      });

      expect(result.network).toBe("Stellar Testnet");
      expect(result.estimatedGasFee).toBe("0.00001");
    });
  });

  describe("formatGenericTransaction", () => {
    it("returns correct operation with custom contract method and description", () => {
      const result = formatGenericTransaction({
        contractMethod: "claim_rewards",
        description: "Claim staking rewards",
        args: { account: "GABC123..." },
      });

      expect(result.operations).toHaveLength(1);
      expect(result.operations[0].type).toBe("claim_rewards");
      expect(result.operations[0].description).toBe("Claim staking rewards");
      expect(result.operations[0].details).toEqual({ account: "GABC123..." });
    });

    it("returns empty balance changes array", () => {
      const result = formatGenericTransaction({
        contractMethod: "update_config",
        description: "Update contract configuration",
      });

      expect(result.balanceChanges).toEqual([]);
    });

    it("handles missing args gracefully", () => {
      const result = formatGenericTransaction({
        contractMethod: "simple_call",
        description: "Simple contract call",
      });

      expect(result.operations[0].details).toBeUndefined();
    });

    it("includes network and estimated gas fee", () => {
      const result = formatGenericTransaction({
        contractMethod: "test",
        description: "Test",
      });

      expect(result.network).toBe("Stellar Testnet");
      expect(result.estimatedGasFee).toBe("0.00001");
    });
  });
});
