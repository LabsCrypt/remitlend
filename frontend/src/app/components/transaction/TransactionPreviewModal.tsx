"use client";

import * as React from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { AlertTriangle, ArrowRight, Info, Fuel } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TransactionOperation {
  type: string;
  description: string;
  amount?: string;
  token?: string;
  from?: string;
  to?: string;
  details?: Record<string, string | number>;
}

export interface BalanceChange {
  token: string;
  change: string;
  isPositive: boolean;
}

export interface TransactionPreviewData {
  operations: TransactionOperation[];
  balanceChanges: BalanceChange[];
  estimatedGasFee?: string;
  network: string;
  contractAddress?: string;
}

interface TransactionPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  data: TransactionPreviewData;
  isLoading?: boolean;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function TransactionPreviewModal({
  isOpen,
  onClose,
  onConfirm,
  data,
  isLoading = false,
}: TransactionPreviewModalProps) {
  const [hasAcknowledged, setHasAcknowledged] = React.useState(false);

  // Reset acknowledgment when modal opens
  React.useEffect(() => {
    if (isOpen) {
      setHasAcknowledged(false);
    }
  }, [isOpen]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Review Transaction" className="max-w-2xl">
      <div className="space-y-6">
        {/* Network Badge */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-sm font-medium text-gray-600 dark:text-zinc-400">
              Network: {data.network}
            </span>
          </div>
          {data.contractAddress && (
            <span className="text-xs text-gray-500 dark:text-zinc-500 font-mono">
              {data.contractAddress.slice(0, 8)}...{data.contractAddress.slice(-6)}
            </span>
          )}
        </div>

        {/* Operations Section */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-gray-900 dark:text-zinc-100 flex items-center gap-2">
            <Info className="h-4 w-4 text-blue-500" />
            Transaction Operations
          </h4>
          <div className="space-y-2">
            {data.operations.map((operation, index) => (
              <div
                key={index}
                className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/50"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-600 dark:bg-blue-500/10 dark:text-blue-400">
                      {index + 1}
                    </span>
                    <span className="font-semibold text-gray-900 dark:text-zinc-100">
                      {operation.type}
                    </span>
                  </div>
                  {operation.amount && (
                    <span className="text-lg font-bold text-gray-900 dark:text-zinc-100">
                      {operation.amount} {operation.token}
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-600 dark:text-zinc-400 ml-8">
                  {operation.description}
                </p>
                {operation.details && Object.keys(operation.details).length > 0 && (
                  <div className="mt-3 ml-8 space-y-1">
                    {Object.entries(operation.details).map(([key, value]) => (
                      <div key={key} className="flex justify-between text-xs">
                        <span className="text-gray-500 dark:text-zinc-500">{key}:</span>
                        <span className="font-medium text-gray-700 dark:text-zinc-300">
                          {value}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Balance Changes Section */}
        {data.balanceChanges.length > 0 && (
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
              Expected Balance Changes
            </h4>
            <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
              {data.balanceChanges.map((change, index) => (
                <div
                  key={index}
                  className={cn(
                    "flex items-center justify-between py-2",
                    index !== data.balanceChanges.length - 1 &&
                      "border-b border-gray-100 dark:border-zinc-800",
                  )}
                >
                  <span className="text-sm font-medium text-gray-700 dark:text-zinc-300">
                    {change.token}
                  </span>
                  <span
                    className={cn(
                      "text-sm font-bold",
                      change.isPositive
                        ? "text-green-600 dark:text-green-400"
                        : "text-red-600 dark:text-red-400",
                    )}
                  >
                    {change.isPositive ? "+" : ""}
                    {change.change}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Gas Fee Section */}
        {data.estimatedGasFee && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-950/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Fuel className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <span className="text-sm font-medium text-amber-900 dark:text-amber-300">
                  Estimated Network Fee
                </span>
              </div>
              <span className="text-sm font-bold text-amber-900 dark:text-amber-300">
                {data.estimatedGasFee} XLM
              </span>
            </div>
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
              Actual fee may vary based on network conditions
            </p>
          </div>
        )}

        {/* Safety Disclaimer */}
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900/50 dark:bg-red-950/20">
          <div className="flex gap-3">
            <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-red-900 dark:text-red-300">
                Important Safety Information
              </h4>
              <ul className="space-y-1 text-xs text-red-800 dark:text-red-400">
                <li>• Double-check all transaction details before confirming</li>
                <li>• Transactions on the blockchain cannot be reversed</li>
                <li>• Only sign transactions you fully understand</li>
                <li>• Never share your private keys or seed phrase</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Acknowledgment Checkbox */}
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={hasAcknowledged}
            onChange={(e) => setHasAcknowledged(e.target.checked)}
            className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
          />
          <span className="text-sm text-gray-700 dark:text-zinc-300">
            I have reviewed the transaction details and understand that this action cannot be undone
          </span>
        </label>

        {/* Action Buttons */}
        <div className="flex gap-3 pt-2">
          <Button variant="outline" onClick={onClose} disabled={isLoading} className="flex-1">
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={onConfirm}
            disabled={!hasAcknowledged || isLoading}
            isLoading={isLoading}
            rightIcon={!isLoading ? <ArrowRight className="h-4 w-4" /> : undefined}
            className="flex-1"
          >
            {isLoading ? "Processing..." : "Sign Transaction"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
