"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Spinner } from "../components/global_ui/Spinner";
import { ErrorBoundary } from "../components/global_ui/ErrorBoundary";
import {
  useWalletStore,
  selectWalletAddress,
  selectWalletNetwork,
  selectIsWalletConnected,
} from "../stores/useWalletStore";
import Link from "next/link";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getHorizonUrl(networkName: string | null | undefined): string {
  const isMainnet =
    networkName?.toLowerCase().includes("mainnet") || networkName?.toLowerCase().includes("public");
  return isMainnet ? "https://horizon.stellar.org" : "https://horizon-testnet.stellar.org";
}

function getExplorerBase(networkName: string | null | undefined): string {
  const isMainnet =
    networkName?.toLowerCase().includes("mainnet") || networkName?.toLowerCase().includes("public");
  return isMainnet
    ? "https://stellar.expert/explorer/public"
    : "https://stellar.expert/explorer/testnet";
}

// ─── Horizon types ─────────────────────────────────────────────────────────────

interface HorizonBalance {
  balance: string;
  asset_type: "native" | "credit_alphanum4" | "credit_alphanum12" | "liquidity_pool_shares";
  asset_code?: string;
  asset_issuer?: string;
}

interface HorizonPayment {
  id: string;
  type: string;
  amount?: string;
  asset_type?: string;
  asset_code?: string;
  from?: string;
  to?: string;
  transaction_hash: string;
  created_at: string;
  source_account?: string;
}

// ─── Horizon data hooks ────────────────────────────────────────────────────────

function useHorizonBalances(address: string, horizonUrl: string) {
  return useQuery<HorizonBalance[]>({
    queryKey: ["horizon", "balances", address, horizonUrl],
    queryFn: async () => {
      const res = await fetch(`${horizonUrl}/accounts/${address}`);
      if (!res.ok) throw new Error(`Horizon returned ${res.status}`);
      const data = await res.json();
      return (data.balances ?? []) as HorizonBalance[];
    },
    staleTime: 30_000,
    retry: 2,
  });
}

function useHorizonPayments(address: string, horizonUrl: string) {
  return useQuery<HorizonPayment[]>({
    queryKey: ["horizon", "payments", address, horizonUrl],
    queryFn: async () => {
      const res = await fetch(
        `${horizonUrl}/accounts/${address}/payments?limit=20&order=desc&include_failed=false`,
      );
      if (!res.ok) throw new Error(`Horizon returned ${res.status}`);
      const data = await res.json();
      return (data._embedded?.records ?? []) as HorizonPayment[];
    },
    staleTime: 30_000,
    retry: 2,
  });
}

// ─── Copy button ───────────────────────────────────────────────────────────────

function CopyButton({ value }: { value: string }) {
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
      className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 dark:hover:text-zinc-200 dark:hover:bg-zinc-800 transition-colors"
      title="Copy to clipboard"
    >
      {copied ? <CheckCheck className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
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
          <div className="h-40 w-40 rounded-lg bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 flex flex-col items-center justify-center gap-2">
            <QrCode className="h-16 w-16 text-zinc-300 dark:text-zinc-700" />
            <p className="text-xs text-zinc-400 dark:text-zinc-500 text-center px-2">
              Install <code>qrcode.react</code> to render
            </p>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 font-mono text-center break-all max-w-xs">
            {address}
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

// ─── Balances card ─────────────────────────────────────────────────────────────

function BalancesCard({ address, horizonUrl }: { address: string; horizonUrl: string }) {
  const {
    data: balances,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useHorizonBalances(address, horizonUrl);

  function assetLabel(b: HorizonBalance): string {
    return b.asset_type === "native" ? "XLM" : (b.asset_code ?? "Unknown");
  }

  function formatBalance(b: HorizonBalance): string {
    const num = parseFloat(b.balance);
    return isNaN(num) ? b.balance : num.toLocaleString("en-US", { maximumFractionDigits: 7 });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Token Balances</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />}
            onClick={() => refetch()}
            disabled={isFetching}
          >
            Refresh
          </Button>
        </div>
        <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">Live from Stellar Horizon</p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner size={24} type={"spin"} />
          </div>
        ) : isError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900/50 dark:bg-red-950/20">
            <p className="text-sm text-red-700 dark:text-red-400">
              Failed to load balances from Horizon.
            </p>
          </div>
        ) : !balances || balances.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400 text-center py-8">
            No balances found for this account.
          </p>
        ) : (
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {balances.map((b, i) => (
              <div key={i} className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-full bg-indigo-50 dark:bg-indigo-500/10 flex items-center justify-center">
                    <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">
                      {assetLabel(b).slice(0, 3)}
                    </span>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                      {assetLabel(b)}
                    </p>
                    {b.asset_issuer && (
                      <p className="text-xs text-zinc-400 dark:text-zinc-500 font-mono">
                        {b.asset_issuer.slice(0, 8)}…
                      </p>
                    )}
                  </div>
                </div>
                <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50">
                  {formatBalance(b)}
                </p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Transaction history (Horizon payments) ────────────────────────────────────

function TransactionHistoryCard({
  address,
  horizonUrl,
  explorerBase,
}: {
  address: string;
  horizonUrl: string;
  explorerBase: string;
}) {
  const { data: payments, isLoading, isError } = useHorizonPayments(address, horizonUrl);

  function isInflow(p: HorizonPayment): boolean {
    return p.to === address || (p.type === "create_account" && p.source_account !== address);
  }

  function paymentLabel(p: HorizonPayment): string {
    switch (p.type) {
      case "payment":
        return isInflow(p) ? "Received" : "Sent";
      case "create_account":
        return "Account Created";
      case "path_payment_strict_send":
      case "path_payment_strict_receive":
        return "Path Payment";
      default:
        return p.type.replace(/_/g, " ");
    }
  }

  function counterparty(p: HorizonPayment): string {
    const addr = isInflow(p) ? p.from : p.to;
    if (!addr) return "—";
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  }

  function paymentAmount(p: HorizonPayment): string {
    if (!p.amount) return "—";
    const asset = p.asset_type === "native" ? "XLM" : (p.asset_code ?? "");
    return `${parseFloat(p.amount).toLocaleString("en-US", { maximumFractionDigits: 7 })} ${asset}`;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Transaction History</CardTitle>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          Recent payments from Stellar Horizon
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner size={24} type={"spin"} />
          </div>
        ) : isError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900/50 dark:bg-red-950/20">
            <p className="text-sm text-red-700 dark:text-red-400">
              Failed to load transaction history from Horizon.
            </p>
          </div>
        ) : !payments || payments.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400 text-center py-8">
            No transactions found.
          </p>
        ) : (
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {payments.map((p) => (
              <div key={p.id} className="flex items-center justify-between py-3 gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 ${
                      isInflow(p)
                        ? "bg-green-50 dark:bg-green-500/10"
                        : "bg-zinc-50 dark:bg-zinc-900"
                    }`}
                  >
                    {isInflow(p) ? (
                      <ArrowDownLeft className="h-4 w-4 text-green-600 dark:text-green-400" />
                    ) : (
                      <ArrowUpRight className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50 truncate capitalize">
                      {paymentLabel(p)}
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 font-mono truncate">
                      {counterparty(p)}
                    </p>
                  </div>
                </div>
                <div className="text-right shrink-0 flex items-center gap-2">
                  <div>
                    <p
                      className={`text-sm font-bold ${
                        isInflow(p)
                          ? "text-green-600 dark:text-green-400"
                          : "text-zinc-900 dark:text-zinc-50"
                      }`}
                    >
                      {isInflow(p) ? "+" : "-"}
                      {paymentAmount(p)}
                    </p>
                    <p className="text-xs text-zinc-400 dark:text-zinc-500">
                      {formatDate(p.created_at)}
                    </p>
                  </div>
                  <a
                    href={`${explorerBase}/tx/${p.transaction_hash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1 text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                    title="View on Stellar Explorer"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
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

  const horizonUrl = getHorizonUrl(network?.name);
  const explorerBase = getExplorerBase(network?.name);

  return (
    <main className="space-y-8 min-h-screen p-8 lg:p-12 max-w-5xl mx-auto">
      <header>
        <p className="text-sm font-semibold uppercase tracking-widest text-indigo-600">My Wallet</p>
        <h1 className="mt-1 text-3xl font-bold text-zinc-900 dark:text-zinc-50">Wallet</h1>
      </header>

      {/* Address card */}
      <ErrorBoundary scope="wallet address" variant="section">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <CardTitle>Stellar Address</CardTitle>
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
          </CardHeader>
          <CardContent className="space-y-4">
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
                href={`${explorerBase}/account/${address}`}
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

      {/* Balances + quick actions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ErrorBoundary scope="token balances" variant="section">
          <BalancesCard address={address} horizonUrl={horizonUrl} />
        </ErrorBoundary>

        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              {
                href: "/lend",
                icon: ArrowDownLeft,
                iconClass: "text-indigo-600 dark:text-indigo-400",
                bg: "bg-indigo-50 dark:bg-indigo-500/10",
                title: "Deposit to Pool",
                desc: "Earn yield by supplying liquidity",
              },
              {
                href: "/lend",
                icon: ArrowUpRight,
                iconClass: "text-green-600 dark:text-green-400",
                bg: "bg-green-50 dark:bg-green-500/10",
                title: "Withdraw from Pool",
                desc: "Withdraw your deposits + yield",
              },
              {
                href: "/loans",
                icon: ArrowDownLeft,
                iconClass: "text-amber-600 dark:text-amber-400",
                bg: "bg-amber-50 dark:bg-amber-500/10",
                title: "View Loans",
                desc: "Manage active loans and repayments",
              },
            ].map((action) => (
              <Link
                key={action.title}
                href={action.href}
                className="flex items-center justify-between rounded-lg border border-zinc-200 bg-zinc-50 p-4 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800 transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`h-9 w-9 rounded-full ${action.bg} flex items-center justify-center`}
                  >
                    <action.icon className={`h-4 w-4 ${action.iconClass}`} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                      {action.title}
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">{action.desc}</p>
                  </div>
                </div>
                <ArrowUpRight className="h-4 w-4 text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-300 transition-colors" />
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Transaction history from Horizon */}
      <ErrorBoundary scope="transaction history" variant="section">
        <TransactionHistoryCard
          address={address}
          horizonUrl={horizonUrl}
          explorerBase={explorerBase}
        />
      </ErrorBoundary>
    </main>
  );
}
