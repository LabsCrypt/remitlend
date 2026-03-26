import { ArrowUpRight, ArrowDownLeft, Plus, Send } from "lucide-react";
import { ErrorBoundary } from "../components/global_ui/ErrorBoundary";

export default function WalletPage() {
  return (
    <section className="space-y-6 pb-20 md:pb-0">
      <header>
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">
          Wallet
        </p>
        <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">My Wallet</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">
          Manage your funds and view transaction history.
        </p>
      </header>

      <ErrorBoundary scope="wallet balance" variant="section">
        <div className="rounded-3xl border border-zinc-200 bg-gradient-to-br from-indigo-500 to-purple-600 p-6 text-white dark:border-zinc-800">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold opacity-90">Total Balance</h2>
            <div className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
          </div>
          <p className="text-3xl font-bold mb-2">$12,450.00</p>
          <p className="text-sm opacity-75">+12.5% from last month</p>
        </div>
      </ErrorBoundary>

      <ErrorBoundary scope="quick actions" variant="section">
        <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">
          {[
            { title: "Send", desc: "Transfer funds", icon: Send, color: "bg-blue-600" },
            { title: "Receive", desc: "Get paid", icon: ArrowDownLeft, color: "bg-green-600" },
            { title: "Add Funds", desc: "Top up wallet", icon: Plus, color: "bg-purple-600" },
            { title: "Withdraw", desc: "Cash out", icon: ArrowUpRight, color: "bg-orange-600" },
          ].map((action) => (
            <button
              key={action.title}
              className={`${action.color} text-white p-4 rounded-2xl hover:opacity-90 transition-opacity flex flex-col items-center gap-2`}
            >
              <action.icon className="h-6 w-6" />
              <span className="text-sm font-semibold">{action.title}</span>
              <span className="text-xs opacity-75">{action.desc}</span>
            </button>
          ))}
        </div>
      </ErrorBoundary>

      <ErrorBoundary scope="recent transactions" variant="section">
        <div>
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50 mb-4">Recent Transactions</h2>
          <div className="rounded-3xl border border-zinc-200 bg-white overflow-hidden dark:border-zinc-800 dark:bg-zinc-950">
            <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {[
                {
                  type: "Loan Repayment",
                  desc: "From Loan #421",
                  amount: "+$150.00",
                  time: "2 hours ago",
                  status: "completed",
                },
                {
                  type: "Remittance Sent",
                  desc: "To 0x82...12a",
                  amount: "-$500.00",
                  time: "5 hours ago",
                  status: "processing",
                },
                {
                  type: "Wallet Top-up",
                  desc: "Bank transfer",
                  amount: "+$1,000.00",
                  time: "Yesterday",
                  status: "completed",
                },
              ].map((item, i) => (
                <div
                  key={i}
                  className="flex items-center gap-4 p-4 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors"
                >
                  <div
                    className={`h-10 w-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                      item.status === "completed"
                        ? "bg-green-50 dark:bg-green-500/10"
                        : "bg-indigo-50 dark:bg-indigo-500/10"
                    }`}
                  >
                    {item.amount.startsWith("+") ? (
                      <ArrowDownLeft className="h-5 w-5 text-green-600 dark:text-green-400" />
                    ) : (
                      <ArrowUpRight className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50 truncate">
                      {item.type}
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                      {item.desc}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50">
                      {item.amount}
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                      {item.time}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </ErrorBoundary>
    </section>
  );
}
