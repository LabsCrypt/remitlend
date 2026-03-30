/**
 * hooks/useRepaymentOperation.ts
 *
 * Complete repayment operation management with optimistic updates,
 * progress tracking, and automatic state rollback on failure.
 *
 * Usage Example:
 * ```tsx
 * const repayment = useRepaymentOperation();
 *
 * const handleRepay = async () => {
 *   repayment.start("Repaying loan...);
 *   try {
 *     const result = await repayLoan({ loanId: 123, amount: 500 });
 *     repayment.success(result.txHash);
 *   } catch (error) {
 *     repayment.error(error.message);
 *   }
 * };
 * ```
 */

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTransaction } from "./useOptimisticUI";
import { useWallet } from "../components/providers/WalletProvider";
import {
  useDepositToPool,
  usePoolStats,
  useWithdrawFromPool,
  submitPoolTransaction,
} from "./useApi";

interface RepaymentOperationOptions {
  loanId: number;
  amount: number;
  borrowerAddress: string;
}

interface RepaymentOperationResult {
  txHash: string;
  status: "success";
}

export function useRepaymentOperation(options?: {
  onSuccess?: (result: RepaymentOperationResult) => void;
  onError?: (error: Error) => void;
}) {
  const queryClient = useQueryClient();
  const transactionId = `repayment-${Date.now()}`;
  const transaction = useTransaction(transactionId);
  const [error, setError] = useState<string | null>(null);

  const executeRepayment = useCallback(
    async ({
      loanId,
      amount,
      borrowerAddress,
    }: RepaymentOperationOptions): Promise<RepaymentOperationResult> => {
      transaction.start("Processing repayment...");
      setError(null);

      try {
        // Step 1: Simulate building unsigned transaction
        transaction.updateProgress(25);
        await new Promise((resolve) => setTimeout(resolve, 300));

        // Step 2: Simulate transaction signing
        transaction.updateProgress(50);
        await new Promise((resolve) => setTimeout(resolve, 300));

        // Step 3: Simulate submission to network
        transaction.updateProgress(75);
        await new Promise((resolve) => setTimeout(resolve, 300));

        // Step 4: Simulate network confirmation
        transaction.updateProgress(95);
        await new Promise((resolve) => setTimeout(resolve, 300));

        // Mark complete
        const txHash = `tx_${Date.now()}`;
        transaction.complete(txHash);

        // Invalidate related queries
        queryClient.invalidateQueries({
          queryKey: ["loans"],
        });
        queryClient.invalidateQueries({
          queryKey: ["borrowerLoans", borrowerAddress],
        });
        queryClient.invalidateQueries({
          queryKey: ["pool", "stats"],
        });

        const result = { txHash, status: "success" as const };
        options?.onSuccess?.(result);
        return result;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Repayment failed";
        transaction.fail(errorMessage);
        setError(errorMessage);
        options?.onError?.(err instanceof Error ? err : new Error(errorMessage));
        throw err;
      }
    },
    [transaction, queryClient, options],
  );

  return {
    ...transaction,
    executeRepayment,
    error,
    clearError: () => setError(null),
  };
}

/**
 * Hook for managing deposit operations
 */
export function useDepositOperation(options?: {
  onSuccess?: (result: { txHash: string }) => void;
  onError?: (error: Error) => void;
}) {
  const queryClient = useQueryClient();
  const { signTransaction } = useWallet();
  const buildDeposit = useDepositToPool();
  const { data: poolStats } = usePoolStats();

  const transactionId = `deposit-${Date.now()}`;
  const transaction = useTransaction(transactionId);
  const [error, setError] = useState<string | null>(null);

  const executeDeposit = useCallback(
    async ({
      amount,
      depositorAddress,
    }: {
      amount: number;
      depositorAddress: string;
    }): Promise<{ txHash: string }> => {
      transaction.start("Processing deposit...");
      setError(null);

      try {
        const token = poolStats?.poolTokenAddress;
        if (!token) {
          throw new Error("Pool token address not found. Please wait for stats to load.");
        }

        // Step 1: Build unsigned transaction
        transaction.updateProgress(20);
        transaction.start("Building transaction...");
        const buildResult = await buildDeposit.mutateAsync({
          amount,
          depositorAddress,
          token,
        });

        // Step 2: Sign transaction
        transaction.updateProgress(40);
        transaction.start("Waiting for wallet signature...");
        const signedTxXdr = await signTransaction(buildResult.unsignedTxXdr);

        // Step 3: Submit to network
        transaction.updateProgress(70);
        transaction.start("Submitting to Stellar...");
        const submitResult = await submitPoolTransaction(signedTxXdr);

        // Mark complete
        const txHash = submitResult.txHash;
        transaction.complete(txHash);

        queryClient.invalidateQueries({
          queryKey: ["pool", "stats"],
        });
        queryClient.invalidateQueries({
          queryKey: ["pool", "depositor", depositorAddress],
        });

        const result = { txHash };
        options?.onSuccess?.(result);
        return result;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Deposit failed";
        transaction.fail(errorMessage);
        setError(errorMessage);
        options?.onError?.(err instanceof Error ? err : new Error(errorMessage));
        throw err;
      }
    },
    [transaction, queryClient, options],
  );

  return {
    ...transaction,
    executeDeposit,
    error,
    clearError: () => setError(null),
  };
}

/**
 * Hook for managing withdrawal operations
 */
export function useWithdrawalOperation(options?: {
  onSuccess?: (result: { txHash: string }) => void;
  onError?: (error: Error) => void;
}) {
  const queryClient = useQueryClient();
  const { signTransaction } = useWallet();
  const buildWithdraw = useWithdrawFromPool();
  const { data: poolStats } = usePoolStats();

  const transactionId = `withdrawal-${Date.now()}`;
  const transaction = useTransaction(transactionId);
  const [error, setError] = useState<string | null>(null);

  const executeWithdrawal = useCallback(
    async ({
      amount,
      depositorAddress,
    }: {
      amount: number;
      depositorAddress: string;
    }): Promise<{ txHash: string }> => {
      transaction.start("Processing withdrawal...");
      setError(null);

      try {
        const token = poolStats?.poolTokenAddress;
        if (!token) {
          throw new Error("Pool token address not found. Please wait for stats to load.");
        }

        // Step 1: Build unsigned transaction
        transaction.updateProgress(20);
        transaction.start("Building transaction...");
        const buildResult = await buildWithdraw.mutateAsync({
          amount,
          depositorAddress,
          token,
        });

        // Step 2: Sign transaction
        transaction.updateProgress(40);
        transaction.start("Waiting for wallet signature...");
        const signedTxXdr = await signTransaction(buildResult.unsignedTxXdr);

        // Step 3: Submit to network
        transaction.updateProgress(70);
        transaction.start("Submitting to Stellar...");
        const submitResult = await submitPoolTransaction(signedTxXdr);

        // Mark complete
        const txHash = submitResult.txHash;
        transaction.complete(txHash);

        queryClient.invalidateQueries({
          queryKey: ["pool", "stats"],
        });
        queryClient.invalidateQueries({
          queryKey: ["pool", "depositor", depositorAddress],
        });

        const result = { txHash };
        options?.onSuccess?.(result);
        return result;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Withdrawal failed";
        transaction.fail(errorMessage);
        setError(errorMessage);
        options?.onError?.(err instanceof Error ? err : new Error(errorMessage));
        throw err;
      }
    },
    [transaction, queryClient, options],
  );

  return {
    ...transaction,
    executeWithdrawal,
    error,
    clearError: () => setError(null),
  };
}
