"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/Card";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { TransactionPreviewModal } from "../transaction/TransactionPreviewModal";
import { useTransactionPreview } from "../../hooks/useTransactionPreview";
import { formatRemittanceSend } from "../../utils/transactionFormatter";
import { isValidStellarAddress } from "../../utils/stellar";
import { AlertCircle, Send, Loader } from "lucide-react";
import { useCreateRemittance } from "../../hooks/useApi";
import { toast } from "sonner";

interface RemittanceFormProps {
  onSuccess?: () => void;
}

export function RemittanceForm({ onSuccess }: RemittanceFormProps) {
  const t = useTranslations("RemittanceForm");
  const [recipientAddress, setRecipientAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [token, setToken] = useState("USDC");
  const [memo, setMemo] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const txPreview = useTransactionPreview();
  const mutation = useCreateRemittance();

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!recipientAddress.trim()) {
      newErrors.recipientAddress = t("recipientRequired");
    } else if (!isValidStellarAddress(recipientAddress)) {
      newErrors.recipientAddress = t("recipientInvalid");
    }

    if (!amount) {
      newErrors.amount = t("amountRequired");
    } else {
      const numAmount = parseFloat(amount);
      if (isNaN(numAmount) || numAmount <= 0) {
        newErrors.amount = t("amountInvalid");
      }
    }

    if (memo && memo.length > 28) {
      newErrors.memo = t("memoHelper");
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleAddressChange = (value: string) => {
    setRecipientAddress(value.trim());
    if (errors.recipientAddress) {
      setErrors({ ...errors, recipientAddress: "" });
    }
  };

  const handleAmountChange = (value: string) => {
    setAmount(value);
    if (errors.amount) {
      setErrors({ ...errors, amount: "" });
    }
  };

  const handleMemoChange = (value: string) => {
    setMemo(value);
    if (errors.memo) {
      setErrors({ ...errors, memo: "" });
    }
  };

  const handleReviewTransaction = async () => {
    if (!validateForm()) {
      toast.error(t("validationError"), {
        description: t("validationErrorDesc"),
      });
      return;
    }

    const numAmount = parseFloat(amount);

    const previewData = formatRemittanceSend({
      amount: numAmount,
      recipient: recipientAddress,
      token,
    });

    txPreview.show(previewData, async () => {
      await handleSubmitRemittance(numAmount);
    });
  };

  const handleSubmitRemittance = async (numAmount: number) => {
    try {
      await mutation.mutateAsync({
        amount: numAmount,
        fromCurrency: token,
        toCurrency: token,
        recipientAddress,
        memo: memo || undefined,
      });

      toast.success(t("successTitle"), {
        description: t("successDesc"),
      });

      // Reset form
      setRecipientAddress("");
      setAmount("");
      setMemo("");
      setErrors({});

      onSuccess?.();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t("errorTitle");
      toast.error(t("errorTitle"), {
        description: errorMessage,
      });
    }
  };

  return (
    <>
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Send className="h-5 w-5" />
              {t("title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Recipient Address */}
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                {t("recipientAddress")} <span className="text-red-600">*</span>
              </label>
              <Input
                placeholder={t("recipientAddressPlaceholder")}
                value={recipientAddress}
                onChange={(e) => handleAddressChange(e.target.value)}
                disabled={mutation.isPending}
                className={errors.recipientAddress ? "border-red-600" : ""}
              />
              {errors.recipientAddress && (
                <div className="flex items-start gap-2 text-sm text-red-600">
                  <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <span>{errors.recipientAddress}</span>
                </div>
              )}
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {t("recipientAddressHelper")}
              </p>
            </div>

            {/* Token Selection */}
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                {t("token")} <span className="text-red-600">*</span>
              </label>
              <select
                value={token}
                onChange={(e) => setToken(e.target.value)}
                disabled={mutation.isPending}
                className="w-full px-3 py-2 border border-zinc-300 rounded-lg bg-white dark:bg-zinc-900 dark:border-zinc-700 text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-indigo-600 dark:focus:ring-indigo-400"
              >
                <option value="USDC">USDC</option>
                <option value="EURC">EURC</option>
                <option value="PHP">PHP</option>
              </select>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("tokenHelper")}</p>
            </div>

            {/* Amount */}
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                {t("amount")} <span className="text-red-600">*</span>
              </label>
              <Input
                type="number"
                placeholder={t("amountPlaceholder")}
                value={amount}
                onChange={(e) => handleAmountChange(e.target.value)}
                disabled={mutation.isPending}
                min="0"
                step="0.01"
                className={errors.amount ? "border-red-600" : ""}
              />
              {errors.amount && (
                <div className="flex items-start gap-2 text-sm text-red-600">
                  <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <span>{errors.amount}</span>
                </div>
              )}
            </div>

            {/* Memo (Optional) */}
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                {t("memo")}{" "}
                <span className="text-zinc-400">({t("optional", { ns: "Common" })})</span>
              </label>
              <textarea
                placeholder={t("memoPlaceholder")}
                value={memo}
                onChange={(e) => handleMemoChange(e.target.value)}
                disabled={mutation.isPending}
                maxLength={28}
                rows={2}
                className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-indigo-600 dark:focus:ring-indigo-400 resize-none dark:border-zinc-700 ${
                  errors.memo ? "border-red-600" : "border-zinc-300"
                }`}
              />
              {errors.memo && (
                <div className="flex items-start gap-2 text-sm text-red-600">
                  <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <span>{errors.memo}</span>
                </div>
              )}
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {memo.length}/28 characters
              </p>
            </div>

            {/* Warning Box */}
            <div className="mt-6 p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg">
              <div className="flex gap-3">
                <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-amber-800 dark:text-amber-300">
                  <p className="font-semibold mb-1">Before sending:</p>
                  <ul className="list-disc list-inside space-y-1 text-xs">
                    <li>Double-check the recipient address</li>
                    <li>Review the transaction preview</li>
                    <li>Confirm you have sufficient balance</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 pt-4">
              <Button
                onClick={handleReviewTransaction}
                disabled={mutation.isPending || !recipientAddress || !amount}
                className="flex-1"
              >
                {mutation.isPending ? (
                  <>
                    <Loader className="h-4 w-4 mr-2 animate-spin" />
                    {t("sendingButton")}
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-2" />
                    {t("reviewButton")}
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Information Card */}
        <Card className="bg-indigo-50 dark:bg-indigo-950/30 border-indigo-200 dark:border-indigo-800">
          <CardContent className="pt-6">
            <h3 className="font-semibold text-indigo-900 dark:text-indigo-300 mb-3">
              About Remittances
            </h3>
            <ul className="space-y-2 text-sm text-indigo-800 dark:text-indigo-400">
              <li className="flex gap-2">
                <span className="font-bold">•</span>
                <span>Remittances help build your credit score</span>
              </li>
              <li className="flex gap-2">
                <span className="font-bold">•</span>
                <span>Funds are secured on the Stellar blockchain</span>
              </li>
              <li className="flex gap-2">
                <span className="font-bold">•</span>
                <span>Transactions are typically confirmed within seconds</span>
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>

      <TransactionPreviewModal
        isOpen={txPreview.isOpen}
        onClose={txPreview.close}
        onConfirm={txPreview.confirm}
        data={txPreview.data || { operations: [], balanceChanges: [], network: "Stellar Testnet" }}
        isLoading={mutation.isPending}
      />
    </>
  );
}
