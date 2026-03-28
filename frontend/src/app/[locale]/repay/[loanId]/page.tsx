"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import { Button } from "../../../components/ui/Button";
import {
  TransactionConfirmModal,
  type TransactionConfirmData,
} from "../../../components/ui/TransactionConfirmModal";

export default function RepayLoanPage() {
  const params = useParams<{ loanId: string }>();
  const loanId = params?.loanId ?? "unknown";

  const [amount, setAmount] = useState("250");
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const network =
    process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE?.includes("Test") ||
    !process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE
      ? "Testnet"
      : "Mainnet";

  const confirmData = useMemo<TransactionConfirmData>(
    () => ({
      type: "Repayment",
      amount: `${Number(amount || "0").toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })} USDC`,
      feeEstimate: "0.00001 XLM",
      gasEstimate: "~0.00001 XLM",
      network,
      details: [
        { label: "Loan ID", value: loanId.toString() },
        { label: "Action", value: "Repay existing loan" },
      ],
    }),
    [amount, loanId, network],
  );

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setNotice(null);
    setIsConfirmOpen(true);
  };

  const onConfirm = async () => {
    setIsSubmitting(true);
    setIsConfirmOpen(false);

    // Placeholder simulation of signing/submission while backend transaction
    // endpoint integration is being finalized for this route.
    await new Promise((resolve) => setTimeout(resolve, 1200));

    setIsSubmitting(false);
    setNotice("Repayment transaction submitted successfully.");
  };

  return (
    <section className="mx-auto max-w-3xl space-y-6">
      <header>
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">
          Borrower Portal
        </p>
        <h1 className="mt-3 text-3xl font-bold text-zinc-900 dark:text-zinc-50">
          Repay Loan #{loanId}
        </h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          Review repayment details in the confirmation modal before signing.
        </p>
      </header>

      <form
        onSubmit={onSubmit}
        className="space-y-4 rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm shadow-zinc-200/50 dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-none"
      >
        <div>
          <label
            htmlFor="repayment-amount"
            className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            Repayment amount
          </label>
          <input
            id="repayment-amount"
            type="number"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className="mt-2 w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-zinc-900 outline-none transition focus:border-indigo-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </div>

        <Button type="submit" className="w-full" isLoading={isSubmitting}>
          Continue to confirmation
        </Button>
      </form>

      {notice && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-300">
          {notice}
        </p>
      )}

      <TransactionConfirmModal
        isOpen={isConfirmOpen}
        data={confirmData}
        isLoading={isSubmitting}
        onCancel={() => setIsConfirmOpen(false)}
        onConfirm={onConfirm}
      />
    </section>
  );
}
