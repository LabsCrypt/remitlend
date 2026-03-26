"use client";

import { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/Card";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { TransactionPreviewModal } from "../transaction/TransactionPreviewModal";
import { useTransactionPreview } from "../../hooks/useTransactionPreview";
import { formatLoanRepayment } from "../../utils/transactionFormatter";
import { DollarSign, AlertCircle } from "lucide-react";
import { useGamificationStore } from "../../stores/useGamificationStore";

interface LoanRepaymentFormProps {
  loanId: number;
  totalOwed: number;
  minPayment?: number;
}

export function LoanRepaymentForm({ loanId, totalOwed, minPayment = 0 }: LoanRepaymentFormProps) {
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const txPreview = useTransactionPreview();
  const gamificationStore = useGamificationStore();

  const handleAmountChange = (value: string) => {
    setAmount(value);
    setError(null);
  };

  const validateAmount = (): boolean => {
    const numAmount = parseFloat(amount);

    if (!amount || isNaN(numAmount)) {
      setError("Please enter a valid amount");
      return false;
    }

    if (numAmount <= 0) {
      setError("Amount must be greater than 0");
      return false;
    }

    if (minPayment > 0 && numAmount < minPayment) {
      setError(`Minimum payment is ${minPayment} USDC`);
      return false;
    }

    if (numAmount > totalOwed) {
      setError(`Amount cannot exceed total owed (${totalOwed} USDC)`);
      return false;
    }

    return true;
  };

  const handleRepayClick = () => {
    if (!validateAmount()) return;

    const numAmount = parseFloat(amount);

    // Show transaction preview modal
    const previewData = formatLoanRepayment({
      loanId,
      amount: numAmount,
    });

    txPreview.show(previewData, async () => {
      // This is where the actual transaction would be executed
      // For now, we'll simulate it
      await simulateRepayment(loanId, numAmount);
    });
  };

  const simulateRepayment = async (loanId: number, amount: number): Promise<void> => {
    // Simulate API call delay
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // TODO: Replace with actual smart contract call
    // Example: await loanContract.repay(loanId, amount);

    // TODO: Success notification will be handled by useContractMutation wrapper
    // when integrated with actual contract calls

    // TEMPORARY: Trigger gamification directly since there's no actual API mutation yet
    gamificationStore.addXP(50, "Loan repayment");
    gamificationStore.unlockAchievement("first_repayment");

    // Also trigger on-time streak if applicable (demo purpose here)
    const isStreak = Math.random() > 0.5; // Simulate streak detection
    if (isStreak) {
      setTimeout(() => {
        gamificationStore.addXP(100, "On-time repayment streak");
        gamificationStore.unlockAchievement("streak_master");
      }, 1000); // Trigger after first notification
    }

    // Reset form
    setAmount("");
  };

  const handlePayFullAmount = () => {
    setAmount(totalOwed.toString());
    setError(null);
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Repay Loan #{loanId}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Loan Summary */}
          <div className="rounded-lg bg-gray-50 p-4 dark:bg-zinc-900/50">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm text-gray-600 dark:text-zinc-400">Total Owed</span>
              <span className="text-2xl font-bold text-gray-900 dark:text-zinc-100">
                {totalOwed} USDC
              </span>
            </div>
            {minPayment > 0 && (
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-500 dark:text-zinc-500">Minimum Payment</span>
                <span className="text-sm font-medium text-gray-700 dark:text-zinc-300">
                  {minPayment} USDC
                </span>
              </div>
            )}
          </div>

          {/* Amount Input */}
          <div className="space-y-2">
            <Input
              type="number"
              label="Repayment Amount"
              placeholder="0.00"
              value={amount}
              onChange={(e) => handleAmountChange(e.target.value)}
              error={error || undefined}
              leftIcon={<DollarSign className="h-4 w-4" />}
              helperText="Enter the amount you want to repay in USDC"
            />

            <Button variant="ghost" size="sm" onClick={handlePayFullAmount} className="w-full">
              Pay Full Amount ({totalOwed} USDC)
            </Button>
          </div>

          {/* Info Box */}
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-900/50 dark:bg-blue-950/20">
            <div className="flex gap-2">
              <AlertCircle className="h-4 w-4 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-blue-800 dark:text-blue-300">
                Repaying your loan on time improves your credit score and unlocks better rates for
                future loans.
              </p>
            </div>
          </div>

          {/* Action Button */}
          <Button
            variant="primary"
            onClick={handleRepayClick}
            disabled={!amount || !!error}
            className="w-full"
          >
            Review Repayment
          </Button>
        </CardContent>
      </Card>

      {/* Transaction Preview Modal */}
      {txPreview.data && (
        <TransactionPreviewModal
          isOpen={txPreview.isOpen}
          onClose={txPreview.close}
          onConfirm={txPreview.confirm}
          data={txPreview.data}
          isLoading={txPreview.isLoading}
        />
      )}
    </>
  );
}
