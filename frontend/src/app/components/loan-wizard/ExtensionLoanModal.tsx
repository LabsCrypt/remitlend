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

interface ExtensionLoanModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  loanId: string;
  currentDueDate?: string;
  title: string;
  submitLabel: string;
  cancelLabel: string;
  daysLabel: string;
  newDueDateLabel: string;
  extensionFeeLabel: string;
  feeDisclosure: string;
  extensionFee: number;
  busyLabel: string;
}

function calculateDueDate(baseIso: string | undefined, extensionDays: number): string {
  if (!baseIso || !Number.isFinite(extensionDays) || extensionDays <= 0) {
    return "—";
  }
  const base = new Date(baseIso);
  const next = new Date(base.getTime() + extensionDays * 24 * 60 * 60 * 1000);
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
  daysLabel,
  newDueDateLabel,
  extensionFeeLabel,
  feeDisclosure,
  extensionFee,
  busyLabel,
}: ExtensionLoanModalProps) {
  const isWalletConnected = useWalletStore(selectIsWalletConnected);
  const walletAddress = useWalletStore(selectWalletAddress);
  const toast = useContractToast();

  const [extensionDays, setExtensionDays] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const disabled = isSubmitting || !isWalletConnected || !walletAddress;
  const predictedDueDate = useMemo(
    () => calculateDueDate(currentDueDate, extensionDays),
    [currentDueDate, extensionDays],
  );

  async function handleSubmit() {
    let toastId: string | number | null = null;

    if (!walletAddress) {
      toast.error("Wallet not connected", "Connect your wallet before requesting an extension.");
      return;
    }
    if (
      !Number.isSafeInteger(extensionDays) ||
      extensionDays <= 0 ||
      extensionDays > Math.floor(0xffffffff / 17280)
    ) {
      toast.error("Invalid extension", "Enter a whole number of days within the supported range.");
      return;
    }

    try {
      setIsSubmitting(true);
      toastId = toast.showPending("Preparing extension request...");
      const built = await buildExtendLoanTransaction({
        loanId,
        borrowerPublicKey: walletAddress,
        extraLedgers: extensionDays * 17280,
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
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} className="max-w-xl">
      <div className="space-y-5">
        <Input
          label={daysLabel}
          type="number"
          min={1}
          max={Math.floor(0xffffffff / 17280)}
          step={1}
          value={Number.isFinite(extensionDays) ? extensionDays : ""}
          onChange={(event) => setExtensionDays(Number(event.target.value))}
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

        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            {extensionFeeLabel}
          </p>
          <p className="mt-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {extensionFee.toLocaleString(undefined, { maximumFractionDigits: 7 })}
          </p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{feeDisclosure}</p>
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
  );
}
