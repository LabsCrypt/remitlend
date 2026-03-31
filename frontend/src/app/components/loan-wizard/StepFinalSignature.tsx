"use client";

import { useEffect, useRef, useState } from "react";
import { PenLine, CircleAlert, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "../ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/Card";
import { TransactionPreviewModal } from "../transaction/TransactionPreviewModal";
import {
  TransactionStatusTracker,
  type TransactionStatusState,
} from "../ui/TransactionStatusTracker";
import { useTransactionPreview } from "../../hooks/useTransactionPreview";
import { useCreateLoan } from "../../hooks/useApi";
import { useContractToast } from "../../hooks/useContractToast";
import { buildUnsignedLoanRequestXdr } from "../../utils/soroban";
import {
  mapTransactionError,
  pollTransactionStatus,
  type TransactionErrorDetails,
} from "../../utils/transactionErrors";
import type { LoanWizardData } from "./LoanApplicationWizard";

const ANNUAL_RATE_PERCENT = 12;

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

interface StepFinalSignatureProps {
  data: LoanWizardData;
  borrowerAddress: string;
  onBack: () => void;
  onSuccess: (loanId: string) => void;
}

export function StepFinalSignature({
  data,
  borrowerAddress,
  onBack,
  onSuccess,
}: StepFinalSignatureProps) {
  const [unsignedXdr, setUnsignedXdr] = useState<string>("");
  const [xdrError, setXdrError] = useState<string | null>(null);
  const [isBuildingXdr, setIsBuildingXdr] = useState(false);
  const [trackerState, setTrackerState] = useState<TransactionStatusState>("idle");
  const [trackerTitle, setTrackerTitle] = useState("Ready to submit");
  const [trackerMessage, setTrackerMessage] = useState("");
  const [trackerGuidance, setTrackerGuidance] = useState<string | undefined>(undefined);
  const [trackerTxHash, setTrackerTxHash] = useState<string | null>(null);
  const [lastErrorDetails, setLastErrorDetails] = useState<TransactionErrorDetails | null>(null);

  const pollingAbortControllerRef = useRef<AbortController | null>(null);

  const txPreview = useTransactionPreview();
  const createLoan = useCreateLoan();
  const toast = useContractToast();

  const principal = Number(data.amount || "0");
  const estimatedInterest = (principal * ANNUAL_RATE_PERCENT * data.termDays) / (365 * 100);
  const totalRepayment = principal + estimatedInterest;
  const dueDate = addDays(new Date(), data.termDays);

  // Pre-build the XDR so the user can see it in the summary.
  // All setState calls happen inside an async IIFE to satisfy react-hooks/set-state-in-effect.
  useEffect(() => {
    if (!borrowerAddress || principal <= 0) return;

    let cancelled = false;

    void (async () => {
      const managerContractId = process.env.NEXT_PUBLIC_MANAGER_CONTRACT_ID;
      if (!managerContractId) {
        if (!cancelled) setXdrError("Missing NEXT_PUBLIC_MANAGER_CONTRACT_ID configuration.");
        return;
      }

      if (!cancelled) {
        setIsBuildingXdr(true);
        setXdrError(null);
      }

      try {
        const xdr = await buildUnsignedLoanRequestXdr({
          borrower: borrowerAddress,
          amount: principal,
          contractId: managerContractId,
        });
        if (!cancelled) setUnsignedXdr(xdr);
      } catch (err) {
        if (!cancelled)
          setXdrError(err instanceof Error ? err.message : "Failed to build unsigned XDR.");
      } finally {
        if (!cancelled) setIsBuildingXdr(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [borrowerAddress, principal]);

  useEffect(() => {
    return () => {
      pollingAbortControllerRef.current?.abort();
      pollingAbortControllerRef.current = null;
    };
  }, []);

  const resetTracker = () => {
    setTrackerState("idle");
    setTrackerTitle("Ready to submit");
    setTrackerMessage("");
    setTrackerGuidance(undefined);
    setTrackerTxHash(null);
    setLastErrorDetails(null);
  };

  const cancelTracking = () => {
    pollingAbortControllerRef.current?.abort();
    pollingAbortControllerRef.current = null;
    setTrackerState("cancelled");
    setTrackerTitle("Status tracking cancelled");
    setTrackerMessage("You cancelled this transaction flow.");
    setTrackerGuidance("If needed, you can retry submission.");
  };

  const handleSignAndSubmit = () => {
    const managerContractId = process.env.NEXT_PUBLIC_MANAGER_CONTRACT_ID;
    if (!managerContractId) {
      setXdrError("Missing NEXT_PUBLIC_MANAGER_CONTRACT_ID configuration.");
      return;
    }

    resetTracker();

    txPreview.show(
      {
        operations: [
          {
            type: "request_loan",
            description: `Request ${formatMoney(principal)} for ${data.termDays} days`,
            amount: principal.toString(),
            token: data.asset,
            details: {
              "Credit Score": data.creditScore,
              "Interest Rate (APR)": `${ANNUAL_RATE_PERCENT}%`,
              "Estimated Due Date": dueDate.toLocaleDateString(),
              Term: `${data.termDays} days`,
              ...(unsignedXdr && {
                "Unsigned XDR": `${unsignedXdr.slice(0, 16)}...${unsignedXdr.slice(-16)}`,
              }),
            },
          },
        ],
        balanceChanges: [{ token: data.asset, change: `${principal}`, isPositive: true }],
        estimatedGasFee: "0.00001",
        network: "Stellar Testnet",
        contractAddress: managerContractId,
      },
      async () => {
        let toastId: string | number | null = null;

        setTrackerState("signing");
        setTrackerTitle("Waiting for wallet signature");
        setTrackerMessage("Approve the transaction in your wallet to continue.");

        try {
          setTrackerState("submitting");
          setTrackerTitle("Submitting transaction");
          setTrackerMessage("Sending your loan request to the network.");
          toastId = toast.showPending("Transaction submitted");

          const loan = await createLoan.mutateAsync({
            amount: principal,
            currency: data.asset,
            interestRate: ANNUAL_RATE_PERCENT,
            termDays: data.termDays,
            borrowerId: borrowerAddress,
          });

          if (!loan.txHash) {
            setTrackerState("success");
            setTrackerTitle("Loan request submitted");
            setTrackerMessage("Your request was accepted and recorded.");
            setTrackerGuidance("You can monitor approval status from your loans dashboard.");
            if (toastId !== null) {
              toast.showSuccess(toastId, {
                successMessage: "Loan request submitted successfully",
              });
            } else {
              toast.success("Loan request submitted successfully");
            }
            onSuccess(loan.id);
            return;
          }

          setTrackerTxHash(loan.txHash);
          setTrackerState("polling");
          setTrackerTitle("Waiting for on-chain confirmation");
          setTrackerMessage("Tracking transaction status on Stellar testnet.");

          const controller = new AbortController();
          pollingAbortControllerRef.current = controller;

          const pollResult = await pollTransactionStatus(loan.txHash, {
            signal: controller.signal,
          });

          pollingAbortControllerRef.current = null;

          if (pollResult.status === "success") {
            setTrackerState("success");
            setTrackerTitle("Transaction confirmed");
            setTrackerMessage("Your loan request is confirmed on-chain.");
            setTrackerGuidance("You can monitor approval status from your loans dashboard.");
            if (toastId !== null) {
              toast.showSuccess(toastId, {
                successMessage: "Loan request confirmed on-chain",
                txHash: loan.txHash,
              });
            }
            onSuccess(loan.id);
            return;
          }

          if (pollResult.status === "cancelled") {
            setTrackerState("cancelled");
            setTrackerTitle("Status tracking cancelled");
            setTrackerMessage(pollResult.message);
            setTrackerGuidance("You can retry tracking or submit again.");
            return;
          }

          const pollError = mapTransactionError(
            pollResult.status === "failed"
              ? "Transaction failed on-chain"
              : "Network timeout while polling status",
          );

          if (toastId !== null) {
            toast.showError(toastId, {
              errorMessage: pollError.title,
              retryAction: retrySubmission,
            });
          } else {
            toast.error(pollError.title, pollResult.message);
          }

          setLastErrorDetails(pollError);
          setTrackerState("error");
          setTrackerTitle(pollError.title);
          setTrackerMessage(pollResult.message);
          setTrackerGuidance(pollError.guidance);
        } catch (error) {
          const mapped = mapTransactionError(error);
          setLastErrorDetails(mapped);

          if (mapped.cancelledByUser) {
            setTrackerState("cancelled");
          } else {
            setTrackerState("error");
          }

          setTrackerTitle(mapped.title);
          setTrackerMessage(mapped.message);
          setTrackerGuidance(mapped.guidance);

          if (toastId !== null) {
            toast.showError(toastId, {
              errorMessage: mapped.title,
              retryAction: mapped.retryable ? retrySubmission : undefined,
            });
          } else {
            toast.error(mapped.title, mapped.message);
          }

          throw error;
        }
      },
    );
  };

  const retrySubmission = () => {
    txPreview.close();
    handleSignAndSubmit();
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <PenLine className="h-5 w-5 text-indigo-500" />
            Final Signature
          </CardTitle>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Review the full loan summary, then sign and submit your application.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Loan summary recap */}
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
            <div className="bg-zinc-50 px-4 py-3 dark:bg-zinc-900">
              <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Loan Summary</p>
            </div>
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {[
                { label: "Asset", value: data.asset },
                { label: "Principal", value: formatMoney(principal) },
                { label: "Term", value: `${data.termDays} days` },
                { label: "APR", value: `${ANNUAL_RATE_PERCENT}%` },
                { label: "Estimated Interest", value: formatMoney(estimatedInterest) },
                {
                  label: "Total Repayment",
                  value: formatMoney(totalRepayment),
                  highlight: true,
                },
                {
                  label: "Due Date",
                  value: dueDate.toLocaleDateString("en-US", {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  }),
                },
                {
                  label: "Borrower",
                  value: `${borrowerAddress.slice(0, 8)}…${borrowerAddress.slice(-6)}`,
                },
                { label: "Credit Score", value: data.creditScore.toString() },
                { label: "Collateral", value: "RemittanceNFT (locked on approval)" },
              ].map(({ label, value, highlight }) => (
                <div key={label} className="flex justify-between px-4 py-2.5 text-sm">
                  <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
                  <span
                    className={
                      highlight
                        ? "font-semibold text-indigo-600 dark:text-indigo-400"
                        : "font-medium text-zinc-900 dark:text-zinc-50"
                    }
                  >
                    {value}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* XDR preview */}
          <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Unsigned Soroban XDR
            </p>
            {isBuildingXdr && (
              <div
                role="status"
                className="mt-2 flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400"
              >
                <Loader2 className="h-4 w-4 animate-spin" />
                Building transaction...
              </div>
            )}
            {xdrError && (
              <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
                <CircleAlert className="mt-0.5 h-3 w-3 shrink-0" />
                {xdrError} (XDR preview unavailable — you may still proceed)
              </div>
            )}
            {unsignedXdr && !isBuildingXdr && (
              <p className="mt-2 break-all font-mono text-xs text-zinc-600 dark:text-zinc-400">
                {unsignedXdr}
              </p>
            )}
          </div>

          <TransactionStatusTracker
            state={trackerState}
            title={trackerTitle}
            message={trackerMessage}
            guidance={trackerGuidance}
            txHash={trackerTxHash}
            onCancel={
              trackerState === "signing" ||
              trackerState === "submitting" ||
              trackerState === "polling"
                ? cancelTracking
                : undefined
            }
            onRetry={
              trackerState === "error" || trackerState === "cancelled"
                ? lastErrorDetails?.retryable === false
                  ? undefined
                  : retrySubmission
                : undefined
            }
            disabled={createLoan.isPending || txPreview.isLoading}
          />

          <div className="flex gap-3">
            <Button variant="outline" onClick={onBack} className="w-full">
              Back
            </Button>
            <Button
              onClick={handleSignAndSubmit}
              isLoading={createLoan.isPending}
              disabled={isBuildingXdr}
              className="w-full"
              leftIcon={<CheckCircle2 className="h-4 w-4" />}
            >
              Sign &amp; Submit
            </Button>
          </div>
        </CardContent>
      </Card>

      {txPreview.data && (
        <TransactionPreviewModal
          isOpen={txPreview.isOpen}
          onClose={txPreview.close}
          onConfirm={txPreview.confirm}
          data={txPreview.data}
          isLoading={txPreview.isLoading || createLoan.isPending}
        />
      )}
    </div>
  );
}
