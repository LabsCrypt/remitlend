import Link from "next/link";
import { ArrowRight, Calendar, DollarSign } from "lucide-react";
import { ErrorBoundary } from "../components/global_ui/ErrorBoundary";

const loans = [
  {
    id: 421,
    borrower: "Farmer Collective",
    amount: "$1,240",
    dueDate: "Apr 18, 2024",
    status: "due-soon",
    nextPayment: "$250",
  },
  {
    id: 422,
    borrower: "Solar Retail Hub",
    amount: "$980",
    dueDate: "Apr 30, 2024",
    status: "on-track",
    nextPayment: "$150",
  },
  {
    id: 423,
    borrower: "Tech Startup",
    amount: "$2,100",
    dueDate: "May 15, 2024",
    status: "on-track",
    nextPayment: "$350",
  },
];

export default function RepayPage() {
  return (
    <section className="space-y-6 pb-20 md:pb-0">
      <header>
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">
          Borrower Portal
        </p>
        <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">Repay Loans</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">
          Manage your loan repayments and view upcoming payment schedules.
        </p>
      </header>

      <ErrorBoundary scope="repayment summary" variant="section">
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { label: "Total Outstanding", value: "$4,320", icon: DollarSign },
            { label: "Next Payment Due", value: "Apr 18", icon: Calendar },
            { label: "Monthly Payment", value: "$750", icon: DollarSign },
          ].map((item) => (
            <article
              key={item.label}
              className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm shadow-zinc-200/50 dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-none"
            >
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-indigo-50 p-3 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300">
                  <item.icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">{item.label}</p>
                  <p className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                    {item.value}
                  </p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </ErrorBoundary>

      <ErrorBoundary scope="loans list" variant="section">
        <div>
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50 mb-4">Active Loans</h2>
          <div className="space-y-4">
            {loans.map((loan) => (
              <article
                key={loan.id}
                className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm shadow-zinc-200/50 dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-none"
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50 truncate">
                        Loan #{loan.id}
                      </h3>
                      <span
                        className={`px-2 py-1 text-xs font-medium rounded-full ${
                          loan.status === "due-soon"
                            ? "bg-orange-100 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400"
                            : "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400"
                        }`}
                      >
                        {loan.status === "due-soon" ? "Due Soon" : "On Track"}
                      </span>
                    </div>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-3">
                      {loan.borrower}
                    </p>
                    <div className="flex flex-wrap gap-4 text-sm">
                      <div>
                        <span className="text-zinc-500 dark:text-zinc-400">Total: </span>
                        <span className="font-medium text-zinc-900 dark:text-zinc-50">
                          {loan.amount}
                        </span>
                      </div>
                      <div>
                        <span className="text-zinc-500 dark:text-zinc-400">Due: </span>
                        <span className="font-medium text-zinc-900 dark:text-zinc-50">
                          {loan.dueDate}
                        </span>
                      </div>
                      <div>
                        <span className="text-zinc-500 dark:text-zinc-400">Next: </span>
                        <span className="font-medium text-zinc-900 dark:text-zinc-50">
                          {loan.nextPayment}
                        </span>
                      </div>
                    </div>
                  </div>
                  <Link
                    href={`/repay/${loan.id}`}
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
                  >
                    Make Payment
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </div>
      </ErrorBoundary>
    </section>
  );
}
