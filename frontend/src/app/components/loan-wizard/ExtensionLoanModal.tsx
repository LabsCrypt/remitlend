"use client";

import { useMemo, useState } from "react";
import { signTransaction } from "@stellar/freighter-api";
import { Modal } from "../ui/Modal";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { buildExtendLoanTransaction, submitLoanTransaction } from "../../hooks/useApi";
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

interface ExtensionLoanModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  loanId: string;
  currentDueDate?: string;
  title: string;
  submitLabel: string;
  cancelLabel: string;
  ledgersLabel: string;
  newDueDateLabel: string;
  busyLabel: string;
}

const LEDGER_CLOSE_SECONDS = 5;

function calculateDueDate(baseIso: string | undefined, extraLedgers: number): string {
  if (!baseIso || !Number.isFinite(extraLedgers) || extraLedgers <= 0) {
    return "—";
  }
  const base = new Date(baseIso);
  const next = new Date(base.getTime() + extraLedgers * LEDGER_CLOSE_SECONDS * 1000);
  return next.toLocaleString();
}

export function ExtensionLoanModal({
  isOpen,
  onClose,
  onSuccess,
  loanId,
  currentDueDate,
  title,
  submitLabel,
  cancelLabel,
  ledgersLabel,
  newDueDateLabel,
  busyLabel,
}: ExtensionLoanModalProps) {
  const isWalletConnected = useWalletStore(selectIsWalletConnected);
  const walletAddress = useWalletStore(selectWalletAddress);
  const toast = useContractToast();
  const txPreview = useTransactionPreview();

  const [extraLedgers, setExtraLedgers] = useState(17280);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const disabled = isSubmitting || !isWalletConnected || !walletAddress;
  const predictedDueDate = useMemo(
    () => calculateDueDate(currentDueDate, extraLedgers),
    [currentDueDate, extraLedgers],
  );

  function handleSubmit() {
    if (!walletAddress) {
      toast.error("Wallet not connected", "Connect your wallet before requesting an extension.");
      return;
    }
    if (!Number.isFinite(extraLedgers) || extraLedgers <= 0) {
      toast.error("Invalid extension", "Extra ledgers must be a positive number.");
      return;
    }

    const previewData: TransactionPreviewData = {
      operations: [
        {
          type: "extend_loan",
          description: `Extend loan #${loanId} by ${Math.round(extraLedgers)} ledgers`,
          details: {
            "Loan ID": loanId,
            "Extra Ledgers": Math.round(extraLedgers),
            ...(currentDueDate ? { "Current Due Date": currentDueDate } : {}),
            ...(predictedDueDate !== "—" ? { "New Due Date": predictedDueDate } : {}),
          },
        },
      ],
      balanceChanges: [],
      network: "Stellar Testnet",
    };

    txPreview.show(previewData, executeExtension);
  }

  async function executeExtension() {
    let toastId: string | number | null = null;
    try {
      setIsSubmitting(true);
      toastId = toast.showPending("Preparing extension request...");
      const built = await buildExtendLoanTransaction({
        loanId,
        borrowerPublicKey: walletAddress,
        extraLedgers: Math.round(extraLedgers),
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
        successMessage: "Extension request confirmed",
        txHash: submitted.txHash,
      });
      onSuccess();
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Extension request failed";
      if (toastId) {
        toast.showError(toastId, {
          errorMessage: message,
        });
      } else {
        toast.error("Extension request failed", message);
      }
      throw error;
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title={title} className="max-w-xl">
        <div className="space-y-5">
          <Input
            label={ledgersLabel}
            type="number"
            min={1}
            step={1}
            value={Number.isFinite(extraLedgers) ? extraLedgers : ""}
            onChange={(event) => setExtraLedgers(Number(event.target.value))}
            disabled={disabled}
          />

          <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              {newDueDateLabel}
            </p>
            <p className="mt-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {predictedDueDate}
            </p>
          </div>

          {isSubmitting && (
            <div className="space-y-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="h-4 w-32 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
              <div className="h-10 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
            </div>
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
