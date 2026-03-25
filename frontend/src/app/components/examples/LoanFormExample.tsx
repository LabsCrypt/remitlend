/**
 * components/examples/LoanFormExample.tsx
 *
 * Example component demonstrating how to use the toast notification system
 * with blockchain transactions. This shows the integration of:
 * - useContractMutation for automatic toast notifications
 * - useContractToast for manual toast control
 * - Transaction lifecycle feedback (Pending → Success/Failed)
 * - Stellar Expert links for successful transactions
 *
 * This is a reference implementation - adapt to your specific use case.
 */

"use client";

import { useState } from "react";
import { useCreateLoan } from "@/app/hooks/useApi";
import { useContractMutation } from "@/app/hooks/useContractMutation";
import { useContractToast } from "@/app/hooks/useContractToast";
import { Button } from "@/app/components/ui/Button";
import { Input } from "@/app/components/ui/Input";
import { Card, CardHeader, CardTitle, CardContent } from "@/app/components/ui/Card";

export function LoanFormExample() {
  const [amount, setAmount] = useState("");
  const [interestRate, setInterestRate] = useState("");
  const toast = useContractToast();

  // Approach 1: Using useContractMutation wrapper (Recommended)
  const createLoanMutation = useContractMutation(useCreateLoan(), {
    pendingMessage: "Creating loan on blockchain...",
    successMessage: "Loan created successfully!",
    errorMessage: "Failed to create loan",
    network: "testnet",
  });

  // Approach 2: Manual toast control (for custom logic)
  const createLoanManual = useCreateLoan();

  const handleSubmitAutomatic = (e: React.FormEvent) => {
    e.preventDefault();

    createLoanMutation.mutate({
      amount: parseFloat(amount),
      currency: "USDC",
      interestRate: parseFloat(interestRate),
      termDays: 30,
      borrowerId: "user-123",
    });
  };

  const handleSubmitManual = async (e: React.FormEvent) => {
    e.preventDefault();

    const toastId = toast.showPending("Creating loan on blockchain...");

    try {
      const result = await createLoanManual.mutateAsync({
        amount: parseFloat(amount),
        currency: "USDC",
        interestRate: parseFloat(interestRate),
        termDays: 30,
        borrowerId: "user-123",
      });

      toast.showSuccess(toastId, {
        successMessage: "Loan created successfully!",
        txHash: result.txHash,
        network: "testnet",
      });
    } catch (error) {
      toast.showError(toastId, {
        errorMessage: error instanceof Error ? error.message : "Failed to create loan",
      });
    }
  };

  return (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle>Create Loan (Toast Example)</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmitAutomatic} className="space-y-4">
          <Input
            label="Loan Amount (USDC)"
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="1000"
            required
          />
          <Input
            label="Interest Rate (%)"
            type="number"
            step="0.1"
            value={interestRate}
            onChange={(e) => setInterestRate(e.target.value)}
            placeholder="5.5"
            required
          />

          <div className="flex gap-2">
            <Button type="submit" disabled={createLoanMutation.isPending} className="flex-1">
              {createLoanMutation.isPending ? "Creating..." : "Create Loan (Auto)"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleSubmitManual}
              disabled={createLoanManual.isPending}
              className="flex-1"
            >
              {createLoanManual.isPending ? "Creating..." : "Create Loan (Manual)"}
            </Button>
          </div>
        </form>

        {/* Demo buttons for testing different toast states */}
        <div className="mt-6 space-y-2 border-t pt-4">
          <p className="text-sm font-medium text-gray-700 dark:text-zinc-300">Test Toasts:</p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => toast.success("Success!", { txHash: "abc123" })}
            >
              Success
            </Button>
            <Button size="sm" variant="outline" onClick={() => toast.error("Error occurred")}>
              Error
            </Button>
            <Button size="sm" variant="outline" onClick={() => toast.info("Info message")}>
              Info
            </Button>
            <Button size="sm" variant="outline" onClick={() => toast.warning("Warning message")}>
              Warning
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
