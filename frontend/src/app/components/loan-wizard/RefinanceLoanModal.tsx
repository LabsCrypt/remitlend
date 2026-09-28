"use client";

import { useMemo, useState } from "react";
import { signTransaction } from "@stellar/freighter-api";
import { Modal } from "../ui/Modal";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { RepaymentScheduleTable } from "./RepaymentScheduleTable";
import {
  buildRefinanceLoanTransaction,
  submitLoanTransaction,
  useLoanAmortizationPreview,
} from "../../hooks/useApi";
import { useContractToast } from "../../hooks/useContractToast";
import {
  selectIsWalletConnected,
  selectWalletAddress,
  useWalletStore,
} from "../../stores/useWalletStore";
import { useTransactionPreview } from "../../hooks/useTransactionPreview";
import {
  TransactionPreviewModal,
  type TransactionPreviewData,
} from "../transaction/TransactionPreviewModal";

interface RefinanceLoanModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  loanId: string;
  currentPrincipal: number;
  currentInterestRate: number;
  defaultTermDays?: 30 | 60 | 90;
  title: string;
  submitLabel: string;
  cancelLabel: string;
  principalLabel: string;
  interestRateLabel: string;
  termLabel: string;
  previewTitle: string;
  previewDescription: string;
  busyLabel: string;
}

const TERM_OPTIONS: Array<30 | 60 | 90> = [30, 60, 90];
const LEDGERS_PER_DAY = 17280;

export function RefinanceLoanModal({
  isOpen,
  onClose,
  onSuccess,
  loanId,
  currentPrincipal,
  currentInterestRate,
  defaultTermDays = 30,
  title,
  submitLabel,
  cancelLabel,
  principalLabel,
  interestRateLabel,
  termLabel,
  previewTitle,
  previewDescription,
  busyLabel,
}: RefinanceLoanModalProps) {
  const isWalletConnected = useWalletStore(selectIsWalletConnected);
  const walletAddress = useWalletStore(selectWalletAddress);
  const toast = useContractToast();
  const txPreview = useTransactionPreview();

  const [newPrincipal, setNewPrincipal] = useState<number>(
    Math.max(1, Math.round(currentPrincipal)),
  );
  const [interestRatePercent, setInterestRatePercent] = useState<number>(
    Number.isFinite(currentInterestRate) ? currentInterestRate : 0,
  );
  const [termDays, setTermDays] = useState<30 | 60 | 90>(defaultTermDays);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const previewQuery = useLoanAmortizationPreview({
    amount: Math.max(1, Math.round(newPrincipal)),
    termDays,
  });

  const disabled = isSubmitting || !isWalletConnected || !walletAddress;
  const newTermLedgers = useMemo(() => termDays * LEDGERS_PER_DAY, [termDays]);

  function handleSubmit() {
    if (!walletAddress) {
      toast.error("Wallet not connected", "Connect your wallet before refinancing.");
      return;
    }

    if (!Number.isFinite(newPrincipal) || newPrincipal <= 0) {
      toast.error("Invalid amount", "Enter a valid principal amount.");
      return;
    }

    const previewData: TransactionPreviewData = {
      operations: [
        {
          type: "refinance_loan",
          description: `Refinance loan #${loanId} to $${Math.round(newPrincipal)} for ${termDays} days`,
          amount: Math.round(newPrincipal).toString(),
          token: "USDC",
          details: {
            "Loan ID": loanId,
            "New Principal": `$${Math.round(newPrincipal)}`,
            Term: `${termDays} days`,
            ...(previewQuery.data && {
              "Estimated APR": `${previewQuery.data.estimatedApr}%`,
              "Total Repayment": `$${previewQuery.data.totalRepayment}`,
            }),
          },
        },
      ],
      balanceChanges: [],
      network: "Stellar Testnet",
    };

    txPreview.show(previewData, executeRefinance);
  }

  async function executeRefinance() {
    let toastId: string | number | null = null;
    try {
      setIsSubmitting(true);
      toastId = toast.showPending("Preparing refinance transaction...");
      const built = await buildRefinanceLoanTransaction({
        loanId,
        borrowerPublicKey: walletAddress,
        newAmount: Math.round(newPrincipal),
        newTerm: newTermLedgers,
      });

      const signResult = await signTransaction(built.unsignedTxXdr, {
        networkPassphrase: built.networkPassphrase,
      });

      if (signResult.error) {
        throw new Error(
          typeof signResult.error === "string" ? signResult.error : "Failed to sign transaction",
        );
      }

      const submitted = await submitLoanTransaction(signResult.signedTxXdr);
      if (submitted.status !== "SUCCESS") {
        throw new Error("Transaction failed");
      }

      toast.showSuccess(toastId, {
        successMessage: "Refinance transaction confirmed",
        txHash: submitted.txHash,
      });
      onSuccess();
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Refinance failed";
      if (toastId) {
        toast.showError(toastId, {
          errorMessage: message,
        });
      } else {
        toast.error("Refinance failed", message);
      }
      throw error;
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title={title} className="max-w-3xl">
        <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <Input
              label={principalLabel}
              type="number"
              min={1}
              step={1}
              value={Number.isFinite(newPrincipal) ? newPrincipal : ""}
              onChange={(event) => setNewPrincipal(Number(event.target.value))}
              disabled={disabled}
            />
            <Input
              label={interestRateLabel}
              type="number"
              min={0}
              step={0.01}
              value={Number.isFinite(interestRatePercent) ? interestRatePercent : ""}
              onChange={(event) => setInterestRatePercent(Number(event.target.value))}
              disabled={disabled}
              helperText="Displayed for quote review before signing."
            />
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-gray-700 dark:text-zinc-300">{termLabel}</p>
            <div className="grid grid-cols-3 gap-2">
              {TERM_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setTermDays(option)}
                  disabled={disabled}
                  className={`h-10 rounded-lg border text-sm font-medium transition ${
                    termDays === option
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
                  }`}
                >
                  {option}d
                </button>
              ))}
            </div>
          </div>

          {isSubmitting ? (
            <div className="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="h-4 w-40 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
              <div className="h-20 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
            </div>
          ) : previewQuery.data ? (
            <RepaymentScheduleTable
              amortization={previewQuery.data}
              title={previewTitle}
              description={previewDescription}
              compact
            />
          ) : null}

          {previewQuery.isError && (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              Unable to load refinance preview right now.
            </p>
          )}

          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
              {cancelLabel}
            </Button>
            <Button onClick={handleSubmit} isLoading={isSubmitting} disabled={disabled}>
              {isSubmitting ? busyLabel : submitLabel}
            </Button>
          </div>
        </div>
      </Modal>

      {isOpen && txPreview.data && (
        <TransactionPreviewModal
          isOpen={txPreview.isOpen}
          onClose={txPreview.close}
          onConfirm={txPreview.confirm}
          data={txPreview.data}
          isLoading={txPreview.isLoading || isSubmitting}
        />
      )}
    </>
  );
}
