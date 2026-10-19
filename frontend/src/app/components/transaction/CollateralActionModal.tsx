"use client";

import { useState } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  onSubmit: (amount: string) => Promise<void>;
  title: string;
  balance?: number;
  loading?: boolean;
}

export default function CollateralActionModal({
  open,
  onClose,
  onSubmit,
  title,
  balance,
  loading,
}: Props) {
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const numAmount = Number(amount);
  const isValidAmount = amount !== "" && numAmount > 0 && isFinite(numAmount);
  const exceedsBalance = balance !== undefined && numAmount > balance;
  const isDisabled = isSubmitting || loading || exceedsBalance || !isValidAmount;

  if (!open) return null;

  const handleSubmit = async () => {
    setError("");
    setIsSubmitting(true);
    try {
      await onSubmit(amount);
      setAmount("");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Transaction failed";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-xl font-semibold">{title}</h2>

        <div className="mt-4">
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-full rounded-lg border p-3"
            disabled={isSubmitting}
          />

          {balance !== undefined && (
            <p className="mt-2 text-sm text-gray-500">Wallet balance: {balance}</p>
          )}

          {exceedsBalance && (
            <p className="mt-2 text-sm text-red-500">Amount exceeds wallet balance</p>
          )}

          {error && (
            <p className="mt-2 text-sm text-red-500">{error}</p>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-lg border px-4 py-2"
            disabled={isSubmitting}
          >
            Cancel
          </button>

          <button
            disabled={isDisabled}
            onClick={handleSubmit}
            className="rounded-lg bg-black px-4 py-2 text-white disabled:opacity-50"
          >
            {isSubmitting ? "Processing..." : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
