"use client";

import { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { TransactionPreviewModal } from "../components/transaction/TransactionPreviewModal";
import { useTransactionPreview } from "../hooks/useTransactionPreview";
import {
  formatLoanRequest,
  formatLoanRepayment,
  formatDeposit,
  formatWithdraw,
  formatRemittanceSend,
} from "../utils/transactionFormatter";
import { Wallet, ArrowUpRight, ArrowDownLeft, Send, HandCoins } from "lucide-react";

export default function TransactionPreviewDemo() {
  // Gate demo page in production
  if (process.env.NODE_ENV === "production") {
    return (
      <main className="flex min-h-screen items-center justify-center p-8">
        <Card className="max-w-md">
          <CardContent className="p-8 text-center">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-zinc-100 mb-2">
              Demo Not Available
            </h1>
            <p className="text-gray-600 dark:text-zinc-400">
              This demo page is only available in development mode.
            </p>
          </CardContent>
        </Card>
      </main>
    );
  }
  const txPreview = useTransactionPreview();

  const demoTransactions = [
    {
      title: "Request Loan",
      description: "Request a 1000 USDC loan",
      icon: HandCoins,
      color: "bg-blue-500",
      action: () => {
        const data = formatLoanRequest({
          amount: 1000,
          borrower: "GCKFBEIYV2U22IO2BJ4KVJOIP7XPWQGQFKKWXR6DOSJBV7STMAQSMEK4",
        });
        txPreview.show(data, async () => {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          alert("Loan request submitted successfully!");
        });
      },
    },
    {
      title: "Repay Loan",
      description: "Repay 500 USDC for Loan #123",
      icon: Wallet,
      color: "bg-green-500",
      action: () => {
        const data = formatLoanRepayment({
          loanId: 123,
          amount: 500,
        });
        txPreview.show(data, async () => {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          alert("Loan repayment successful!");
        });
      },
    },
    {
      title: "Deposit to Pool",
      description: "Deposit 2000 USDC to earn yield",
      icon: ArrowDownLeft,
      color: "bg-purple-500",
      action: () => {
        const data = formatDeposit({
          amount: 2000,
          token: "USDC",
        });
        txPreview.show(data, async () => {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          alert("Deposit successful!");
        });
      },
    },
    {
      title: "Withdraw from Pool",
      description: "Withdraw 1500 USDC from lending pool",
      icon: ArrowUpRight,
      color: "bg-orange-500",
      action: () => {
        const data = formatWithdraw({
          amount: 1500,
          token: "USDC",
        });
        txPreview.show(data, async () => {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          alert("Withdrawal successful!");
        });
      },
    },
    {
      title: "Send Remittance",
      description: "Send 300 USDC to family",
      icon: Send,
      color: "bg-indigo-500",
      action: () => {
        const data = formatRemittanceSend({
          amount: 300,
          recipient: "GDQWI6FKB72DPOJE4CGYCFQZKRPQQIOYXRMZ5KEVGXMG6UUTGJMBCASH",
          token: "USDC",
        });
        txPreview.show(data, async () => {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          alert("Remittance sent successfully!");
        });
      },
    },
  ];

  return (
    <main className="space-y-8 p-8 lg:p-12 max-w-7xl mx-auto">
      {/* Header */}
      <header>
        <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50 mb-2">
          Transaction Preview Demo
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Click any button below to see the transaction preview modal in action. This modal shows
          users exactly what they're signing before a blockchain transaction.
        </p>
      </header>

      {/* Features Section */}
      <Card>
        <CardHeader>
          <CardTitle>Key Features</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm text-gray-700 dark:text-zinc-300">
            <li className="flex items-start gap-2">
              <span className="text-green-500 mt-1">✓</span>
              <span>
                <strong>Human-readable operations:</strong> Clear descriptions of what each
                transaction does
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-500 mt-1">✓</span>
              <span>
                <strong>Balance changes:</strong> Shows expected changes to your wallet balances
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-500 mt-1">✓</span>
              <span>
                <strong>Gas fee estimation:</strong> Displays estimated network fees in XLM
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-500 mt-1">✓</span>
              <span>
                <strong>Safety disclaimer:</strong> Important warnings before signing
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-500 mt-1">✓</span>
              <span>
                <strong>Acknowledgment required:</strong> Users must confirm they understand before
                proceeding
              </span>
            </li>
          </ul>
        </CardContent>
      </Card>

      {/* Demo Transactions Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {demoTransactions.map((tx, index) => (
          <Card key={index} className="hover:shadow-lg transition-shadow">
            <CardContent className="p-6">
              <div className="flex items-start gap-4 mb-4">
                <div className={`${tx.color} p-3 rounded-lg`}>
                  <tx.icon className="h-6 w-6 text-white" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-900 dark:text-zinc-100 mb-1">
                    {tx.title}
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-zinc-400">{tx.description}</p>
                </div>
              </div>
              <Button variant="outline" onClick={tx.action} className="w-full">
                Try It
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Implementation Notes */}
      <Card>
        <CardHeader>
          <CardTitle>Implementation Notes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h4 className="font-semibold text-gray-900 dark:text-zinc-100 mb-2">
              How to Use in Your Code
            </h4>
            <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-xs">
              {`import { useTransactionPreview } from '@/hooks/useTransactionPreview';
import { formatLoanRepayment } from '@/utils/transactionFormatter';

function MyComponent() {
  const txPreview = useTransactionPreview();

  const handleRepay = () => {
    const data = formatLoanRepayment({ loanId: 123, amount: 500 });
    
    txPreview.show(data, async () => {
      // Execute your transaction here
      await repayLoan(123, 500);
    });
  };

  return (
    <>
      <button onClick={handleRepay}>Repay Loan</button>
      
      {txPreview.data && (
        <TransactionPreviewModal
          isOpen={txPreview.isOpen}
          onClose={txPreview.close}
          onConfirm={txPreview.confirm}
          data={txPreview.data}
          isLoading={txPreview.isLoading}
        />
      )}
    </>
  );
}`}
            </pre>
          </div>
        </CardContent>
      </Card>

      {/* Transaction Preview Modal */}
      {txPreview.data && (
        <TransactionPreviewModal
          isOpen={txPreview.isOpen}
          onClose={txPreview.close}
          onConfirm={txPreview.confirm}
          data={txPreview.data}
          isLoading={txPreview.isLoading}
        />
      )}
    </main>
  );
}
