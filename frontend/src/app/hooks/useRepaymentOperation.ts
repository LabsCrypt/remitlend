/**
 * hooks/useRepaymentOperation.ts
 *
 * Complete repayment operation management with build, wallet-signing,
 * network submission, and progress tracking.
 *
 * Usage Example:
 * ```tsx
 * const repayment = useRepaymentOperation();
 *
 * const handleRepay = async () => {
 *   repayment.start("Repaying loan...);
 *   try {
 *     const result = await repayment.executeRepayment({ loanId: 123, amount: 500 });
 *     repayment.success(result.txHash);
 *   } catch (error) {
 *     repayment.error(error.message);
 *   }
 * };
 * ```
 */

import { useCallback, useId, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTransaction } from "./useOptimisticUI";
import { useWallet } from "../components/providers/WalletProvider";
import {
  useDepositToPool,
  usePoolStats,
  useRepayLoan,
  useWithdrawFromPool,
  submitLoanTransaction,
  submitPoolTransaction,
  queryKeys,
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
  const uid = useId();
  const transactionId = `repayment-${uid}`;
  const transaction = useTransaction(transactionId);
  const [error, setError] = useState<string | null>(null);
  const repayLoan = useRepayLoan();
  const { signTransaction } = useWallet();
  const isExecuting = useRef(false);

  const executeRepayment = useCallback(
    async ({
      loanId,
      amount,
      borrowerAddress,
    }: RepaymentOperationOptions): Promise<RepaymentOperationResult> => {
      if (isExecuting.current) {
        throw new Error("A repayment is already being processed.");
      }

      isExecuting.current = true;
      transaction.start("Processing repayment...");
      setError(null);

      try {
        transaction.updateProgress(20, "Building repayment transaction...");
        const buildResult = await repayLoan.mutateAsync({ loanId, amount, borrowerAddress });

        transaction.sign("Waiting for wallet signature...");
        const signedTxXdr = await signTransaction(buildResult.unsignedTxXdr, {
          networkPassphrase: buildResult.networkPassphrase,
        });

        transaction.updateProgress(70, "Submitting repayment to Stellar...");
        const submitResult = await submitLoanTransaction(signedTxXdr);
        if (submitResult.status !== "SUCCESS" || !submitResult.txHash) {
          throw new Error("Stellar did not confirm the repayment transaction.");
        }

        const txHash = submitResult.txHash;

        transaction.submit(txHash, "Transaction submitted, waiting for confirmation...");
        transaction.confirm("Confirming transaction...");
        transaction.complete(txHash, "Repayment successful!");

        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.loans.detail(String(loanId)) }),
          queryClient.invalidateQueries({
            queryKey: queryKeys.borrowerLoans.byAddress(borrowerAddress),
          }),
          queryClient.invalidateQueries({
            queryKey: queryKeys.loans.borrowerPagePrefix(borrowerAddress),
          }),
          queryClient.invalidateQueries({ queryKey: queryKeys.pool.stats() }),
        ]);

        const result = { txHash, status: "success" as const };
        options?.onSuccess?.(result);
        return result;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Repayment failed";
        transaction.fail(errorMessage);
        setError(errorMessage);
        options?.onError?.(err instanceof Error ? err : new Error(errorMessage));
        throw err;
      } finally {
        isExecuting.current = false;
      }
    },
    [transaction, repayLoan, signTransaction, queryClient, options],
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

  const uid = useId();
  const transactionId = `deposit-${uid}`;
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
        transaction.updateProgress(20, "Building transaction...");
        const buildResult = await buildDeposit.mutateAsync({
          amount,
          depositorAddress,
          token,
        });

        // Step 2: Sign transaction (new signing state)
        transaction.sign("Waiting for wallet signature...");
        const signedTxXdr = await signTransaction(buildResult.unsignedTxXdr);

        // Step 3: Submit to network (new submitted state)
        const submitResult = await submitPoolTransaction(signedTxXdr);
        transaction.submit(
          submitResult.txHash,
          "Transaction submitted, waiting for confirmation...",
        );

        // Step 4: Poll for confirmation (new confirming state)
        transaction.confirm("Confirming transaction...");

        // Simulate confirmation polling (in real implementation, poll the RPC)
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Mark complete
        const txHash = submitResult.txHash;
        transaction.complete(txHash, "Deposit successful!");

        queryClient.invalidateQueries({
          queryKey: queryKeys.pool.stats(),
        });
        queryClient.invalidateQueries({
          queryKey: queryKeys.pool.depositor(depositorAddress),
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

  const uid = useId();
  const transactionId = `withdrawal-${uid}`;
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
        transaction.updateProgress(20, "Building transaction...");
        const buildResult = await buildWithdraw.mutateAsync({
          amount,
          depositorAddress,
          token,
        });

        // Step 2: Sign transaction (new signing state)
        transaction.sign("Waiting for wallet signature...");
        const signedTxXdr = await signTransaction(buildResult.unsignedTxXdr);

        // Step 3: Submit to network (new submitted state)
        const submitResult = await submitPoolTransaction(signedTxXdr);
        transaction.submit(
          submitResult.txHash,
          "Transaction submitted, waiting for confirmation...",
        );

        // Step 4: Poll for confirmation (new confirming state)
        transaction.confirm("Confirming transaction...");

        // Simulate confirmation polling (in real implementation, poll the RPC)
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Mark complete
        const txHash = submitResult.txHash;
        transaction.complete(txHash, "Withdrawal successful!");

        queryClient.invalidateQueries({
          queryKey: queryKeys.pool.stats(),
        });
        queryClient.invalidateQueries({
          queryKey: queryKeys.pool.depositor(depositorAddress),
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
