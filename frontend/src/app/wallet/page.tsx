"use client";

import { useState } from "react";
import {
  Wallet,
  Copy,
  CheckCheck,
  ArrowDownLeft,
  ArrowUpRight,
  RefreshCw,
  QrCode,
  ExternalLink,
  Globe,
  TrendingUp,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Spinner } from "../components/global_ui/Spinner";
import { ErrorBoundary } from "../components/global_ui/ErrorBoundary";
import {
  useWalletStore,
  selectWalletAddress,
  selectWalletNetwork,
  selectWalletBalances,
  selectIsWalletConnected,
} from "../stores/useWalletStore";
import { useLoans, useRemittances } from "../hooks/useApi";
import Link from "next/link";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ─── Copy button ───────────────────────────────────────────────────────────────

function CopyButton({ value, className = "" }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button
      onClick={handleCopy}
      className={`p-1.5 rounded-md text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 dark:hover:text-zinc-200 dark:hover:bg-zinc-800 transition-colors ${className}`}
      title="Copy to clipboard"
    >
      {copied ? (
        <CheckCheck className="h-4 w-4 text-green-500" />
      ) : (
        <Copy className="h-4 w-4" />
      )}
    </button>
  );
}

// ─── QR Code display ──────────────────────────────────────────────────────────

function QRDisplay({ address }: { address: string }) {
  const [show, setShow] = useState(false);

  return (
    <div>
      <Button
        variant="outline"
        size="sm"
        leftIcon={<QrCode className="h-4 w-4" />}
        onClick={() => setShow((v) => !v)}
      >
        {show ? "Hide" : "Show"} QR Code
      </Button>
      {show && (
        <div className="mt-4 flex flex-col items-center gap-3 p-6 rounded-xl border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
          {/* Placeholder QR — in production use a QR library like qrcode.react */}
          <div className="h-40 w-40 rounded-lg bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 flex flex-col items-center justify-center gap-2">
            <QrCode className="h-16 w-16 text-zinc-300 dark:text-zinc-700" />
            <p className="text-xs text-zinc-400 dark:text-zinc-500 text-center px-2">
              QR library not installed
            </p>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 font-mono text-center break-all max-w-xs">
            {address}
          </p>
          <p className="text-xs text-zinc-400 dark:text-zinc-500">
            Share this address to receive tokens
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Connect wallet prompt ─────────────────────────────────────────────────────

function ConnectWalletPrompt() {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-6 p-8">
      <div className="rounded-2xl bg-zinc-50 p-6 dark:bg-zinc-900">
        <Wallet className="h-12 w-12 text-indigo-600 dark:text-indigo-400" />
      </div>
      <div className="text-center">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Wallet</h1>
        <p className="mt-2 max-w-md text-zinc-500 dark:text-zinc-400">
          Connect your Stellar wallet to view your balances and transaction history.
        </p>
      </div>
    </main>
  );
}

// ─── Balance card ──────────────────────────────────────────────────────────────

function BalancesCard() {
  const balances = useWalletStore(selectWalletBalances);
  const isLoading = useWalletStore((s) => s.isLoadingBalances);
  const setLoadingBalances = useWalletStore((s) => s.setLoadingBalances);

  const handleRefresh = () => {
    // In production: re-fetch from Stellar Horizon API and call setBalances
    setLoadingBalances(true);
    setTimeout(() => setLoadingBalances(false), 1000); // placeholder
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Token Balances</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />}
            onClick={handleRefresh}
            disabled={isLoading}
          >
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner size="md" />
          </div>
        ) : balances.length === 0 ? (
          <div className="text-center py-8">
            <TrendingUp className="h-8 w-8 text-zinc-300 dark:text-zinc-600 mx-auto mb-2" />
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              No token balances found.
            </p>
            <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">
              Balances are fetched from Stellar Horizon when wallet is connected.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {balances.map((b) => (
              <div key={b.symbol} className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-full bg-indigo-50 dark:bg-indigo-500/10 flex items-center justify-center">
                    <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">
                      {b.symbol.slice(0, 2)}
                    </span>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                      {b.symbol}
                    </p>
                    {b.usdValue !== null && (
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        {formatCurrency(b.usdValue)}
                      </p>
                    )}
                  </div>
                </div>
                <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50">{b.amount}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Transaction history (from indexed events / remittances) ─────────────────

function TransactionHistoryCard() {
  const isConnected = useWalletStore(selectIsWalletConnected);
  const { data: loans, isLoading: loansLoading } = useLoans({ enabled: isConnected });
  const { data: remittances, isLoading: remLoading } = useRemittances({ enabled: isConnected });

  const isLoading = loansLoading || remLoading;

  const combined = [
    ...(loans ?? []).map((l) => ({
      id: `loan-${l.id}`,
      type: l.status === "repaid" ? "Loan Repaid" : l.status === "active" ? "Loan Active" : "Loan Request",
      description: `Loan #${l.id}`,
      amount: l.status === "repaid" ? l.amount : l.amount,
      isInflow: l.status === "active", // funds came in on approval
      status: l.status,
      date: l.createdAt,
      txHash: undefined as string | undefined,
    })),
    ...(remittances ?? []).map((r) => ({
      id: `rem-${r.id}`,
      type: "Remittance",
      description: `To ${r.recipientAddress.slice(0, 6)}...${r.recipientAddress.slice(-4)}`,
      amount: r.amount,
      isInflow: false,
      status: r.status,
      date: r.createdAt,
      txHash: undefined as string | undefined,
    })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return (
    <Card>
      <CardHeader>
        <CardTitle>Transaction History</CardTitle>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          Loans and remittances from your account.
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner size="md" />
          </div>
        ) : combined.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">No transactions yet.</p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {combined.slice(0, 20).map((tx) => (
              <div key={tx.id} className="flex items-center justify-between py-3 gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`h-9 w-9 rounded-full flex items-center justify-center flex-shrink-0 ${
                      tx.isInflow
                        ? "bg-green-50 dark:bg-green-500/10"
                        : "bg-zinc-50 dark:bg-zinc-900"
                    }`}
                  >
                    {tx.isInflow ? (
                      <ArrowDownLeft className="h-4 w-4 text-green-600 dark:text-green-400" />
                    ) : (
                      <ArrowUpRight className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50 truncate">
                      {tx.type}
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                      {tx.description}
                    </p>
                  </div>
                </div>
                <div className="text-right flex-shrink-0 flex items-center gap-2">
                  <div>
                    <p
                      className={`text-sm font-bold ${
                        tx.isInflow
                          ? "text-green-600 dark:text-green-400"
                          : "text-zinc-900 dark:text-zinc-50"
                      }`}
                    >
                      {tx.isInflow ? "+" : "-"}
                      {formatCurrency(tx.amount)}
                    </p>
                    <p className="text-xs text-zinc-400 dark:text-zinc-500">{formatDate(tx.date)}</p>
                  </div>
                  {tx.txHash && (
                    <a
                      href={`https://stellar.expert/explorer/testnet/tx/${tx.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1 text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                      title="View on Stellar Explorer"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function WalletPage() {
  const isConnected = useWalletStore(selectIsWalletConnected);
  const address = useWalletStore(selectWalletAddress);
  const network = useWalletStore(selectWalletNetwork);

  if (!isConnected || !address) return <ConnectWalletPrompt />;

  const explorerBase =
    network?.name?.toLowerCase().includes("testnet")
      ? "https://stellar.expert/explorer/testnet/account"
      : "https://stellar.expert/explorer/public/account";

  return (
    <main className="space-y-8 min-h-screen p-8 lg:p-12 max-w-5xl mx-auto">
      {/* Header */}
      <header>
        <p className="text-sm font-semibold uppercase tracking-widest text-indigo-600">
          My Wallet
        </p>
        <h1 className="mt-1 text-3xl font-bold text-zinc-900 dark:text-zinc-50">Wallet</h1>
      </header>

      {/* Address card */}
      <ErrorBoundary scope="wallet address" variant="section">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <CardTitle>Stellar Address</CardTitle>
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                    network?.isSupported
                      ? "bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400"
                      : "bg-yellow-50 text-yellow-700 dark:bg-yellow-500/10 dark:text-yellow-400"
                  }`}
                >
                  <Globe className="h-3 w-3" />
                  {network?.name ?? "Unknown Network"}
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Full address */}
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-mono text-zinc-900 dark:text-zinc-50 break-all leading-relaxed">
                  {address}
                </p>
                <CopyButton value={address} />
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <a
                href={`${explorerBase}/${address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900 transition-colors"
              >
                <ExternalLink className="h-4 w-4" />
                View on Explorer
              </a>
              <QRDisplay address={address} />
            </div>
          </CardContent>
        </Card>
      </ErrorBoundary>

      {/* Balances + actions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ErrorBoundary scope="token balances" variant="section">
          <BalancesCard />
        </ErrorBoundary>

        {/* Quick actions */}
        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Link
              href="/lend"
              className="flex items-center justify-between rounded-lg border border-zinc-200 bg-zinc-50 p-4 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800 transition-colors group"
            >
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-full bg-indigo-50 dark:bg-indigo-500/10 flex items-center justify-center">
                  <ArrowDownLeft className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                    Deposit to Pool
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Earn yield by supplying liquidity
                  </p>
                </div>
              </div>
              <ArrowUpRight className="h-4 w-4 text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-300 transition-colors" />
            </Link>

            <Link
              href="/lend"
              className="flex items-center justify-between rounded-lg border border-zinc-200 bg-zinc-50 p-4 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800 transition-colors group"
            >
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-full bg-green-50 dark:bg-green-500/10 flex items-center justify-center">
                  <ArrowUpRight className="h-4 w-4 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                    Withdraw from Pool
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Withdraw your deposits + yield
                  </p>
                </div>
              </div>
              <ArrowUpRight className="h-4 w-4 text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-300 transition-colors" />
            </Link>

            <Link
              href="/loans"
              className="flex items-center justify-between rounded-lg border border-zinc-200 bg-zinc-50 p-4 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800 transition-colors group"
            >
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-full bg-amber-50 dark:bg-amber-500/10 flex items-center justify-center">
                  <ArrowDownLeft className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                    View Loans
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Manage active loans and repayments
                  </p>
                </div>
              </div>
              <ArrowUpRight className="h-4 w-4 text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-300 transition-colors" />
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* Transaction history */}
      <ErrorBoundary scope="transaction history" variant="section">
        <TransactionHistoryCard />
      </ErrorBoundary>
    </main>
  );
}
