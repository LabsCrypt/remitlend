"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/Card";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { TransactionPreviewModal } from "../transaction/TransactionPreviewModal";
import { useTransactionPreview } from "../../hooks/useTransactionPreview";
import { useContractToast } from "../../hooks/useContractToast";
import { formatLoanRepayment } from "../../utils/transactionFormatter";
import {
  prepareRepayTransaction,
  signAndSubmitTransaction,
} from "../../utils/contractService";
import { queryKeys } from "../../hooks/useApi";
import { useWalletStore, selectWalletAddress } from "../../stores/useWalletStore";
import { useGamificationStore } from "../../stores/useGamificationStore";
import { DollarSign, AlertCircle } from "lucide-react";

interface LoanRepaymentFormProps {
  loanId: number;
  totalOwed: number;
  minPayment?: number;
}

export function LoanRepaymentForm({ loanId, totalOwed, minPayment = 0 }: LoanRepaymentFormProps) {
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);

  const txPreview = useTransactionPreview();
  const toast = useContractToast();
  const queryClient = useQueryClient();
  const gamificationStore = useGamificationStore();
  const borrowerAddress = useWalletStore(selectWalletAddress);

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

  const handleRepayClick = async () => {
    if (!validateAmount()) return;
    if (!borrowerAddress) {
      setError("No wallet connected");
      return;
    }

    const numAmount = parseFloat(amount);

    // Step 1: build + simulate on Soroban RPC to get the unsigned XDR.
    // Doing this before opening the modal means the user sees a verified
    // transaction (with correct resource fees) rather than an estimate.
    setIsPreparing(true);
    let xdr: string;
    try {
      xdr = await prepareRepayTransaction(borrowerAddress, loanId, numAmount);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to prepare transaction";
      setError(message);
      setIsPreparing(false);
      return;
    }
    setIsPreparing(false);

    // Step 2: show the preview modal with the verified XDR attached.
    const previewData = formatLoanRepayment({ loanId, amount: numAmount });

    txPreview.show({ ...previewData, rawXDR: xdr }, async () => {
      // Step 3 (on confirm): sign with Freighter and submit.
      const toastId = toast.showPending("Submitting repayment...");

      try {
        const txHash = await signAndSubmitTransaction(xdr);

        toast.showSuccess(toastId, {
          successMessage: "Repayment confirmed on-chain!",
          txHash,
          network: "testnet",
        });

        // Invalidate all loan-related queries so the UI reflects the new state
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.loans.all() }),
          queryClient.invalidateQueries({ queryKey: queryKeys.loans.detail(String(loanId)) }),
          queryClient.invalidateQueries({
            queryKey: queryKeys.borrowerLoans.byAddress(borrowerAddress),
          }),
        ]);

        // Award gamification XP for a real repayment
        gamificationStore.addXP(50, "Loan repayment");
        gamificationStore.unlockAchievement("first_repayment");

        setAmount("");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Repayment failed";
        toast.showError(toastId, { errorMessage: message });
        // Re-throw so useTransactionPreview keeps the modal open for retry
        throw err;
      }
    });
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
            disabled={!amount || !!error || !borrowerAddress || isPreparing}
            isLoading={isPreparing}
            className="w-full"
          >
            {isPreparing ? "Preparing..." : "Review Repayment"}
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
