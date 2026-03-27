"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, CircleAlert, HandCoins } from "lucide-react";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/Card";
import { TransactionPreviewModal } from "../components/transaction/TransactionPreviewModal";
import { useTransactionPreview } from "../hooks/useTransactionPreview";
import { useCreateLoan, useCreditScoreHistory } from "../hooks/useApi";
import { useWalletStore, selectWalletAddress } from "../stores/useWalletStore";
import { buildUnsignedLoanRequestXdr } from "../utils/soroban";

type TermOption = { label: string; days: number };

const TERM_OPTIONS: TermOption[] = [
  { label: "30 days", days: 30 },
  { label: "60 days", days: 60 },
  { label: "90 days", days: 90 },
];

function getScoreBandMax(score: number): number {
  if (score >= 750) return 50_000;
  if (score >= 670) return 25_000;
  if (score >= 580) return 10_000;
  if (score >= 500) return 5_000;
  return 0;
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export default function RequestLoanPage() {
  const borrowerAddress = useWalletStore(selectWalletAddress);
  const txPreview = useTransactionPreview();
  const createLoan = useCreateLoan();
  const [amount, setAmount] = useState("");
  const [termDays, setTermDays] = useState<number>(30);
  const [error, setError] = useState<string | null>(null);
  const [unsignedXdr, setUnsignedXdr] = useState<string>("");
  const [successLoanId, setSuccessLoanId] = useState<string | null>(null);

  const { data: scoreHistory } = useCreditScoreHistory(borrowerAddress ?? undefined, {
    enabled: !!borrowerAddress,
  });

  const creditScore = scoreHistory?.[scoreHistory.length - 1]?.score ?? 720;
  const minAmount = 100;
  const maxAmount = getScoreBandMax(creditScore);
  const annualRatePercent = 12;
  const amountNumber = Number(amount || "0");
  const estimatedInterest = useMemo(
    () => (amountNumber > 0 ? (amountNumber * annualRatePercent * termDays) / (365 * 100) : 0),
    [amountNumber, termDays],
  );
  const estimatedTotalRepayment = amountNumber + estimatedInterest;
  const estimatedDueDate = useMemo(() => {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + termDays);
    return dueDate.toLocaleDateString();
  }, [termDays]);

  const validate = () => {
    if (!borrowerAddress) {
      setError("Connect your wallet before requesting a loan.");
      return false;
    }
    if (!amount || Number.isNaN(amountNumber) || amountNumber <= 0) {
      setError("Enter a valid loan amount.");
      return false;
    }
    if (maxAmount === 0) {
      setError("Your credit score is below 500 and is not currently eligible for a loan.");
      return false;
    }
    if (amountNumber < minAmount) {
      setError(`Minimum request amount is ${formatMoney(minAmount)}.`);
      return false;
    }
    if (amountNumber > maxAmount) {
      setError(`Maximum eligible amount for your score is ${formatMoney(maxAmount)}.`);
      return false;
    }
    setError(null);
    return true;
  };

  const showPreview = async () => {
    if (!validate() || !borrowerAddress) return;

    const managerContractId = process.env.NEXT_PUBLIC_MANAGER_CONTRACT_ID;
    if (!managerContractId) {
      setError("Missing NEXT_PUBLIC_MANAGER_CONTRACT_ID configuration.");
      return;
    }

    try {
      const xdr = await buildUnsignedLoanRequestXdr({
        borrower: borrowerAddress,
        amount: amountNumber,
        contractId: managerContractId,
      });
      setUnsignedXdr(xdr);

      txPreview.show(
        {
          operations: [
            {
              type: "request_loan",
              description: `Request ${formatMoney(amountNumber)} for ${termDays} days`,
              amount: amountNumber.toString(),
              token: "USDC",
              details: {
                "Credit Score": creditScore,
                "Interest Rate (APR)": `${annualRatePercent}%`,
                "Estimated Due Date": estimatedDueDate,
                "Unsigned XDR": `${xdr.slice(0, 16)}...${xdr.slice(-16)}`,
              },
            },
          ],
          balanceChanges: [{ token: "USDC", change: `${amountNumber}`, isPositive: true }],
          estimatedGasFee: "0.00001",
          network: "Stellar Testnet",
          contractAddress: managerContractId,
        },
        async () => {
          const loan = await createLoan.mutateAsync({
            amount: amountNumber,
            currency: "USDC",
            interestRate: annualRatePercent,
            termDays,
            borrowerId: borrowerAddress,
          });
          setSuccessLoanId(loan.id);
        },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to build unsigned transaction.");
    }
  };

  if (successLoanId) {
    return (
      <main className="mx-auto max-w-3xl space-y-6 p-8">
        <Card>
          <CardContent className="space-y-4 p-8 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-green-500" />
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
              Loan Request Submitted
            </h1>
            <p className="text-zinc-600 dark:text-zinc-400">Request ID: {successLoanId}</p>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Next steps: monitor approval status and prepare repayment before the due date.
            </p>
            <div className="flex justify-center gap-3 pt-2">
              <Link href="/loans">
                <Button variant="outline">View Loans</Button>
              </Link>
              <Button onClick={() => setSuccessLoanId(null)}>Request Another</Button>
            </div>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8">
      <header className="space-y-2">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">
          Borrower Portal
        </p>
        <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">Request Loan</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Review your eligibility, preview repayment terms, and build an unsigned Soroban
          transaction for signing.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HandCoins className="h-5 w-5 text-indigo-500" />
              Loan Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              label="Amount (USDC)"
              type="number"
              min={minAmount}
              max={maxAmount || undefined}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="1000"
              helperText={`Eligible range: ${maxAmount === 0 ? "Not eligible" : `${formatMoney(minAmount)} - ${formatMoney(maxAmount)}`}`}
            />

            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Term</label>
              <div className="grid grid-cols-3 gap-2">
                {TERM_OPTIONS.map((option) => (
                  <button
                    key={option.days}
                    type="button"
                    onClick={() => setTermDays(option.days)}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                      termDays === option.days
                        ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300"
                        : "border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
                <CircleAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
                {error}
              </div>
            )}

            <Button
              onClick={showPreview}
              isLoading={createLoan.isPending}
              className="w-full"
              rightIcon={<ArrowRight className="h-4 w-4" />}
            >
              Review Transaction
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Eligibility & Repayment Preview</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="rounded-lg bg-zinc-50 p-4 dark:bg-zinc-900">
              <p className="text-zinc-500 dark:text-zinc-400">Current Credit Score</p>
              <p className="mt-1 text-2xl font-bold text-zinc-900 dark:text-zinc-50">
                {creditScore}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                <p className="text-zinc-500 dark:text-zinc-400">Eligible Max</p>
                <p className="font-semibold text-zinc-900 dark:text-zinc-50">
                  {maxAmount === 0 ? "Ineligible" : formatMoney(maxAmount)}
                </p>
              </div>
              <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                <p className="text-zinc-500 dark:text-zinc-400">Interest Rate (APR)</p>
                <p className="font-semibold text-zinc-900 dark:text-zinc-50">
                  {annualRatePercent}%
                </p>
              </div>
            </div>
            <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <p className="font-semibold text-zinc-900 dark:text-zinc-50">Estimated Repayment</p>
              <p className="mt-2 text-zinc-600 dark:text-zinc-400">
                Principal: {formatMoney(amountNumber || 0)}
              </p>
              <p className="text-zinc-600 dark:text-zinc-400">
                Estimated Interest: {formatMoney(estimatedInterest)}
              </p>
              <p className="mt-1 font-semibold text-zinc-900 dark:text-zinc-50">
                Total Due: {formatMoney(estimatedTotalRepayment)}
              </p>
              <p className="mt-1 text-zinc-500 dark:text-zinc-400">
                Due Date (est.): {estimatedDueDate}
              </p>
            </div>
            {unsignedXdr && (
              <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
                <p className="font-semibold text-zinc-900 dark:text-zinc-50">
                  Unsigned Soroban XDR
                </p>
                <p className="mt-2 break-all font-mono text-xs text-zinc-600 dark:text-zinc-400">
                  {unsignedXdr}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {txPreview.data && (
        <TransactionPreviewModal
          isOpen={txPreview.isOpen}
          onClose={txPreview.close}
          onConfirm={txPreview.confirm}
          data={txPreview.data}
          isLoading={txPreview.isLoading || createLoan.isPending}
        />
      )}
    </main>
  );
}
