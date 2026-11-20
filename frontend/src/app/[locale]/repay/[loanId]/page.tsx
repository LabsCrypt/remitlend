"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "../../../components/ui/Button";
import {
  selectIsWalletConnected,
  selectWalletAddress,
  selectWalletNetwork,
  useWalletStore,
} from "../../../stores/useWalletStore";
import { useContractToast } from "../../../hooks/useContractToast";
import { TransactionPreviewModal } from "../../../components/transaction/TransactionPreviewModal";
import { useTransactionPreview } from "../../../hooks/useTransactionPreview";
import { useRepaymentOperation } from "../../../hooks/useRepaymentOperation";
import {
  buildAmountHelperText,
  getPrecisionError,
  sanitizeAmountInput,
  formatAmountOnBlur,
  getAssetDecimals,
} from "../../../utils/amount";

export default function RepayLoanPage() {
  const params = useParams<{ loanId: string }>();
  const loanId = params?.loanId ?? "unknown";
  const loanIdNumber = Number(loanId);
  const router = useRouter();
  const t = useTranslations("RepayPage");

  const walletAddress = useWalletStore(selectWalletAddress);
  const isWalletConnected = useWalletStore(selectIsWalletConnected);
  const walletNetwork = useWalletStore(selectWalletNetwork);
  const toast = useContractToast();
  const txPreview = useTransactionPreview();
  // Single shared repayment mutation (build → sign → submit) used by both the
  // standalone repay page and the borrower repayment form (#2257). Errors are
  // rethrown so `txPreview.confirm` keeps the modal open on failure instead of
  // silently swallowing them.
  const repayment = useRepaymentOperation({
    onSuccess: () => {
      setTimeout(() => router.refresh(), 2000);
    },
  });

  const [amount, setAmount] = useState("250");

  const amountNumber = useMemo(() => Number(amount || "0"), [amount]);
  const decimals = getAssetDecimals("USDC");
  const precisionError = getPrecisionError(amount, "USDC");
  const helperText = buildAmountHelperText(amount, "USDC", decimals);

  const handleRepayClick = async (event: FormEvent) => {
    event.preventDefault();
    if (walletNetwork && !walletNetwork.isSupported) {
      toast.error(
        "Unsupported wallet network",
        "Repayment is not supported on the current wallet network. Switch your wallet to PUBLIC (mainnet) or TESTNET and try again.",
      );
      return;
    }
    if (!isWalletConnected || !walletAddress || !walletNetwork) {
      toast.error("Wallet not connected", "Please connect your wallet first.");
      return;
    }
    if (!Number.isInteger(loanIdNumber) || loanIdNumber <= 0) {
      toast.error("Invalid loan", "This repayment link does not reference a valid loan.");
      return;
    }
    if (!amount || Number.isNaN(amountNumber) || amountNumber <= 0) {
      toast.error("Invalid amount", "Enter a repayment amount greater than zero.");
      return;
    }
    if (precisionError) {
      toast.error("Invalid precision", precisionError);
      return;
    }

    const contractId = process.env.NEXT_PUBLIC_MANAGER_CONTRACT_ID;
    txPreview.show(
      {
        operations: [
          {
            type: "Repay Loan",
            description: `Repaying ${amountNumber} for loan #${loanId}`,
            amount: amountNumber.toString(),
            token: "USDC",
          },
        ],
        balanceChanges: [
          {
            token: "USDC",
            change: `-${amountNumber}`,
            isPositive: false,
          },
        ],
        estimatedGasFee: "0.01",
        network: "Stellar Testnet",
        contractAddress: contractId ?? "",
      },
      async () => {
        await repayment.executeRepayment({
          loanId: loanIdNumber,
          amount: amountNumber,
          borrowerAddress: walletAddress!,
        });
      },
    );
  };

  return (
    <section className="mx-auto max-w-3xl space-y-6">
      <header>
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">
          {t("eyebrow")}
        </p>
        <h1 className="mt-3 text-3xl font-bold text-zinc-900 dark:text-zinc-50">
          {t("heading", { loanId })}
        </h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          {t("subheading")}
        </p>
      </header>

      <form
        onSubmit={handleRepayClick}
        className="space-y-4 rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm shadow-zinc-200/50 dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-none"
      >
        <div>
          <label
            htmlFor="repayment-amount"
            className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            {t("amountLabel")}
          </label>
          <input
            id="repayment-amount"
            type="text"
            inputMode="decimal"
            step={Math.pow(10, -decimals)}
            value={amount}
            onChange={(event) => setAmount(sanitizeAmountInput(event.target.value))}
            onBlur={(event) => {
              const formatted = formatAmountOnBlur(event.target.value, "USDC");
              if (formatted && formatted !== event.target.value) {
                setAmount(formatted);
              }
            }}
            className={`mt-2 w-full rounded-2xl border bg-zinc-50 px-4 py-3 text-zinc-900 outline-none transition focus:border-indigo-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 ${
              precisionError ? "border-red-500" : "border-zinc-200"
            }`}
          />
          <p
            className={`mt-2 text-xs ${
              precisionError ? "text-red-600 dark:text-red-400" : "text-zinc-500 dark:text-zinc-400"
            }`}
          >
            {precisionError ?? helperText ?? t("decimalsHint", { decimals })}
          </p>
        </div>

        <Button
          type="submit"
          className="w-full"
          isLoading={repayment.isLoading}
          disabled={!!precisionError || repayment.isLoading}
        >
          {t("submitButton")}
        </Button>
      </form>

      {repayment.error && (
        <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
          {repayment.error}
        </p>
      )}

      {txPreview.data && (
        <TransactionPreviewModal
          isOpen={txPreview.isOpen}
          onClose={txPreview.close}
          onConfirm={txPreview.confirm}
          data={txPreview.data}
          isLoading={txPreview.isLoading}
        />
      )}
    </section>
  );
}
