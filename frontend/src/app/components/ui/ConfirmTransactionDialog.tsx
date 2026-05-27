"use client";

import * as React from "react";
import { AlertTriangle } from "lucide-react";
import Modal from "./Modal";

export interface TransactionSummaryItem {
  label: string;
  value: string;
}

interface ConfirmTransactionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: string;
  description?: string;
  /** Key-value pairs displayed in the summary table (amount, recipient, fee…). */
  summary?: TransactionSummaryItem[];
  /** Label for the confirm button. Defaults to "Confirm". */
  confirmLabel?: string;
  /** Show a loading spinner on the confirm button while a tx is in-flight. */
  isLoading?: boolean;
}

/**
 * Reusable confirmation dialog for irreversible blockchain transactions.
 *
 * - Shows a summary of the action (amount, recipient, fees).
 * - Requires explicit user confirmation ("Confirm" / "Cancel").
 * - Dismissible via the Cancel button, backdrop click (Modal handles this),
 *   and ESC key (Modal handles this).
 *
 * Usage:
 * ```tsx
 * <ConfirmTransactionDialog
 *   isOpen={showConfirm}
 *   onClose={() => setShowConfirm(false)}
 *   onConfirm={handleSubmitTx}
 *   title="Confirm Loan Request"
 *   summary={[
 *     { label: "Amount", value: "100 USDC" },
 *     { label: "Fee", value: "~0.001 XLM" },
 *   ]}
 * />
 * ```
 */
const ConfirmTransactionDialog: React.FC<ConfirmTransactionDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title = "Confirm Transaction",
  description = "This action is irreversible once submitted to the blockchain. Please review the details below before confirming.",
  summary = [],
  confirmLabel = "Confirm",
  isLoading = false,
}) => {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="md">
      <div className="space-y-4">
        {/* Warning banner */}
        <div className="flex items-start gap-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-400" aria-hidden="true" />
          <p className="text-sm text-yellow-200/90">{description}</p>
        </div>

        {/* Transaction summary */}
        {summary.length > 0 && (
          <div className="rounded-lg border border-white/10 bg-white/5 p-4">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Transaction Details
            </h3>
            <dl className="space-y-2">
              {summary.map((item) => (
                <div key={item.label} className="flex items-center justify-between gap-4">
                  <dt className="text-sm text-muted-foreground">{item.label}</dt>
                  <dd className="text-sm font-medium text-foreground">{item.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="flex-1 rounded-lg border border-white/20 bg-transparent px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-white/5 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {isLoading ? (
              <span className="flex items-center justify-center gap-2">
                <span
                  className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
                  aria-hidden="true"
                />
                Processing…
              </span>
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default ConfirmTransactionDialog;
