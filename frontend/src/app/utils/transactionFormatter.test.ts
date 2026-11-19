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

  // #2147: Edge case tests for missing timestamps, unknown operations, and malformed amounts
  describe("Edge Cases (#2147)", () => {
    describe("Malformed Amounts", () => {
      it("handles zero amount correctly", () => {
        const result = formatLoanRequest({ amount: 0, borrower: "GABC1234567890DEF" });
        expect(result.operations[0].amount).toBe("0");
        expect(result.balanceChanges[0].change).toBe("0");
      });

      it("handles negative amount", () => {
        const result = formatLoanRepayment({ loanId: 1, amount: -100 });
        expect(result.operations[0].amount).toBe("-100");
        expect(result.balanceChanges[0].change).toBe("--100"); // Note: intentionally testing behavior
      });

      it("handles very large amounts", () => {
        const largeAmount = 999999999999.99;
        const result = formatDeposit({ amount: largeAmount, token: "USDC" });
        expect(result.operations[0].amount).toBe("999999999999.99");
        expect(result.balanceChanges[0].change).toBe("-999999999999.99");
      });

      it("handles extremely small decimal amounts", () => {
        const result = formatWithdraw({ amount: 0.0000001, token: "USDC" });
        expect(result.operations[0].amount).toBe("0.0000001");
        expect(result.balanceChanges[1].change).toBe("0.0000001");
      });

      it("handles NaN amount gracefully", () => {
        const result = formatLoanRequest({ amount: NaN, borrower: "GABC1234567890DEF" });
        expect(result.operations[0].amount).toBe("NaN");
      });

      it("handles Infinity amount", () => {
        const result = formatLoanRepayment({ loanId: 1, amount: Infinity });
        expect(result.operations[0].amount).toBe("Infinity");
      });
    });

    describe("Missing or Invalid Data", () => {
      it("handles empty borrower address", () => {
        const result = formatLoanRequest({ amount: 100, borrower: "" });
        expect(result.operations[0].details?.["Borrower Address"]).toBe("...");
      });

      it("handles very short borrower address", () => {
        const result = formatLoanRequest({ amount: 100, borrower: "GAB" });
        expect(result.operations[0].details?.["Borrower Address"]).toBeDefined();
      });

      it("handles empty token string", () => {
        const result = formatDeposit({ amount: 100, token: "" });
        expect(result.operations[0].token).toBe("");
        expect(result.balanceChanges[1].token).toBe("LP-");
      });

      it("handles special characters in token name", () => {
        const result = formatRemittanceSend({
          amount: 100,
          recipient: "GABC1234567890DEF",
          token: "US$DC@123",
        });
        expect(result.operations[0].token).toBe("US$DC@123");
      });
    });

    describe("Boundary Conditions", () => {
      it("handles loan ID of 0", () => {
        const result = formatLoanRepayment({ loanId: 0, amount: 100 });
        expect(result.operations[0].details?.["Loan ID"]).toBe("0");
        expect(result.operations[0].description).toContain("Loan #0");
      });

      it("handles very large loan ID", () => {
        const result = formatLoanRepayment({ loanId: 2147483647, amount: 100 });
        expect(result.operations[0].details?.["Loan ID"]).toBe("2147483647");
      });

      it("handles undefined args in generic transaction", () => {
        const result = formatGenericTransaction({
          contractMethod: "test",
          description: "Test transaction",
          args: undefined,
        });
        expect(result.operations[0].details).toBeUndefined();
      });

      it("handles empty args object", () => {
        const result = formatGenericTransaction({
          contractMethod: "test",
          description: "Test",
          args: {},
        });
        expect(result.operations[0].details).toEqual({});
      });
    });

    describe("Unknown Operations", () => {
      it("formats unknown operation types through generic formatter", () => {
        const result = formatGenericTransaction({
          contractMethod: "unknown_method_xyz",
          description: "This is an unrecognized contract method",
          args: { param1: "value1", param2: 42 },
        });
        
        expect(result.operations[0].type).toBe("unknown_method_xyz");
        expect(result.operations[0].description).toBe("This is an unrecognized contract method");
        expect(result.operations[0].details).toEqual({ param1: "value1", param2: 42 });
      });

      it("handles generic transaction with complex args", () => {
        const result = formatGenericTransaction({
          contractMethod: "complex_call",
          description: "Complex operation",
          args: {
            nested: "deep",
            array: 123,
            boolean: "true",
          },
        });

        expect(result.operations[0].type).toBe("complex_call");
        expect(result.balanceChanges).toHaveLength(0);
      });
    });

    describe("Network and Gas Fee Consistency", () => {
      it("all formatters return consistent network name", () => {
        const results = [
          formatLoanRequest({ amount: 100, borrower: "GABC" }),
          formatLoanRepayment({ loanId: 1, amount: 100 }),
          formatDeposit({ amount: 100, token: "USDC" }),
          formatWithdraw({ amount: 100, token: "USDC" }),
          formatRemittanceSend({ amount: 100, recipient: "GABC", token: "USDC" }),
          formatGenericTransaction({ contractMethod: "test", description: "Test" }),
        ];

        results.forEach((result) => {
          expect(result.network).toBe("Stellar Testnet");
        });
      });

      it("all formatters return consistent gas fee format", () => {
        const results = [
          formatLoanRequest({ amount: 100, borrower: "GABC" }),
          formatLoanRepayment({ loanId: 1, amount: 100 }),
          formatDeposit({ amount: 100, token: "USDC" }),
        ];

        results.forEach((result) => {
          expect(result.estimatedGasFee).toBe("0.00001");
          expect(typeof result.estimatedGasFee).toBe("string");
        });
      });
    });
  });
});
