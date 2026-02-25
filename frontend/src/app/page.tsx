import { ArrowUpRight, ArrowDownLeft, Users, Activity, Clock, ExternalLink } from "lucide-react";

export default function Home() {
  return (
    <main
      className="space-y-8 min-h-screen p-8 lg:p-12 max-w-7xl mx-auto"
      aria-labelledby="dashboard-title"
    >
      {/* Welcome Section */}
      <header>
        <h1 id="dashboard-title" className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
          Good morning, John!
        </h1>
        <p className="text-zinc-500 dark:text-zinc-400">
          Here is what&apos;s happening with your portfolio today.
        </p>
      </header>

      {/* Stats Grid */}
      <section
        aria-label="Portfolio Statistics"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        {[
          {
            label: "Net Worth",
            value: "$12,450.00",
            change: "+12.5%",
            icon: Activity,
            trend: "up",
          },
          { label: "Active Loans", value: "3", change: "2 pending", icon: Users, trend: "neutral" },
          {
            label: "Total Remitted",
            value: "$8,200.00",
            change: "+$450 today",
            icon: ArrowUpRight,
            trend: "up",
          },
          {
            label: "Yield (APY)",
            value: "11.2%",
            change: "+0.4%",
            icon: ArrowDownLeft,
            trend: "up",
          },
        ].map((stat, i) => (
          <article
            key={i}
            className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950"
          >
            <div className="flex items-center justify-between">
              <div className="rounded-lg bg-zinc-50 p-2 dark:bg-zinc-900" aria-hidden="true">
                <stat.icon className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
              </div>
              <span
                className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  stat.trend === "up"
                    ? "bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400"
                    : "bg-zinc-50 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400"
                }`}
                aria-label={`Change: ${stat.change}`}
              >
                {stat.change}
              </span>
            </div>
            <div className="mt-4">
              <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{stat.label}</p>
              <h3 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{stat.value}</h3>
            </div>
          </article>
        ))}
      </section>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Recent Activity */}
        <section aria-labelledby="activity-heading" className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2
              id="activity-heading"
              className="text-lg font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2"
            >
              <Clock className="h-5 w-5 text-zinc-400" aria-hidden="true" />
              Recent Activity
            </h2>
            <button
              className="text-sm font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 rounded px-2 py-1"
              aria-label="View all recent activity"
            >
              View All
            </button>
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden dark:border-zinc-800 dark:bg-zinc-950">
            <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {[
                {
                  type: "Loan Repayment",
                  desc: "Repayment received for Loan #421",
                  amount: "+$150.00",
                  time: "2 hours ago",
                  status: "completed",
                },
                {
                  type: "Remittance Sent",
                  desc: "Sent to 0x82...12a",
                  amount: "-$500.00",
                  time: "5 hours ago",
                  status: "processing",
                },
                {
                  type: "New Loan Request",
                  desc: "Requested 0.5 ETH for trading",
                  amount: "$1,200.00",
                  time: "Yesterday",
                  status: "pending",
                },
              ].map((item, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between p-4 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div
                      className={`h-10 w-10 rounded-full flex items-center justify-center ${
                        item.status === "completed"
                          ? "bg-green-50 dark:bg-green-500/10"
                          : "bg-indigo-50 dark:bg-indigo-500/10"
                      }`}
                      aria-hidden="true"
                    >
                      {item.amount.startsWith("+") ? (
                        <ArrowDownLeft className="h-5 w-5 text-green-600 dark:text-green-400" />
                      ) : (
                        <ArrowUpRight className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                        {item.type}
                      </p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">{item.desc}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50">
                      {item.amount}
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">{item.time}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Action Sidebar */}
        <aside aria-labelledby="quick-actions-heading" className="space-y-4">
          <h2
            id="quick-actions-heading"
            className="text-lg font-bold text-zinc-900 dark:text-zinc-50"
          >
            Quick Actions
          </h2>
          <div className="space-y-3">
            {[
              { title: "Apply for Loan", desc: "Get instant liquidity", color: "bg-indigo-600" },
              { title: "Send Remittance", desc: "Transfer funds globally", color: "bg-zinc-900" },
            ].map((action, i) => (
              <button
                key={i}
                className={`w-full text-left p-4 rounded-xl ${action.color} text-white hover:opacity-90 transition-opacity shadow-lg shadow-indigo-500/10 focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold">{action.title}</span>
                  <ExternalLink className="h-4 w-4 opacity-50" aria-hidden="true" />
                </div>
                <p className="text-xs opacity-80">{action.desc}</p>
              </button>
            ))}
          </div>

          <section
            className="rounded-xl bg-indigo-50 p-6 dark:bg-indigo-950/30 space-y-4"
            aria-labelledby="outreach-heading"
          >
            <h3 id="outreach-heading" className="font-bold text-indigo-900 dark:text-indigo-300">
              Community Outreach
            </h3>
            <p className="text-sm text-indigo-700 dark:text-indigo-400 leading-relaxed">
              New borrowers in Ghana are looking for micro-loans for agricultural tools. Help grow
              the ecosystem!
            </p>
            <button
              className="text-sm font-bold text-indigo-600 dark:text-indigo-400 flex items-center gap-1 focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-1 rounded"
              aria-label="Explore micro-loan opportunities"
            >
              Explore Opportunities
              <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </section>
        </aside>
      </div>
    </main>
  );
}
