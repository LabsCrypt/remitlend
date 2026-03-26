import Link from "next/link";
import { ArrowRight, CalendarRange, CircleDollarSign, ShieldCheck } from "lucide-react";
import { ErrorBoundary } from "../components/global_ui/ErrorBoundary";

const loans = [
  {
    id: 421,
    borrower: "Farmer Collective",
    status: "Active",
    balance: "$1,240",
    dueDate: "Apr 18",
  },
  {
    id: 422,
    borrower: "Solar Retail Hub",
    status: "Pending",
    balance: "$980",
    dueDate: "Apr 30",
  },
];

export default function LoansPage() {
  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">
            Borrower Portal
          </p>
          <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">Loans</h1>
          <p className="mt-2 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">
            Review active facilities, due dates, and repayment windows from one place.
          </p>
        </div>
      </header>

      <ErrorBoundary scope="loan summary cards" variant="section">
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { label: "Outstanding", value: "$2,220", icon: CircleDollarSign },
            { label: "Due This Week", value: "1 loan", icon: CalendarRange },
            { label: "Portfolio Health", value: "Strong", icon: ShieldCheck },
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

      <ErrorBoundary scope="loan list" variant="section">
        <div className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm shadow-zinc-200/50 dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-none">
          <div className="space-y-3">
            {loans.map((loan) => (
              <article
                key={loan.id}
                className="flex flex-col gap-4 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-50 truncate">
                    Loan #{loan.id}
                  </p>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400 truncate">
                    {loan.borrower}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-sm">
                  <span className="rounded-full bg-zinc-100 px-3 py-1 font-medium text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 whitespace-nowrap">
                    {loan.status}
                  </span>
                  <span className="text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
                    {loan.balance}
                  </span>
                  <span className="text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
                    Due {loan.dueDate}
                  </span>
                </div>
                <Link
                  href={`/loans/${loan.id}`}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-full bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                >
                  View details
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </article>
            ))}
          </div>
        </div>
      </ErrorBoundary>
    </section>
  );
}
