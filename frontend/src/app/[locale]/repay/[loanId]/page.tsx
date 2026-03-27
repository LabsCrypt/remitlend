export default async function RepayLoanPage({ params }: { params: Promise<{ loanId: string }> }) {
  const { loanId } = await params;

  return (
    <section className="mx-auto max-w-3xl space-y-6">
      <header>
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">
          Borrower Portal
        </p>
        <h1 className="mt-3 text-3xl font-bold text-zinc-900 dark:text-zinc-50">
          Repay Loan #{loanId}
        </h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          This payment view is intentionally mobile-friendly so breadcrumb navigation stays usable
          on small screens.
        </p>
      </header>

      <form className="space-y-4 rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm shadow-zinc-200/50 dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-none">
        <div>
          <label
            htmlFor="repayment-amount"
            className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            Repayment amount
          </label>
          <input
            id="repayment-amount"
            type="number"
            defaultValue="250"
            className="mt-2 w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-zinc-900 outline-none transition focus:border-indigo-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </div>
        <button
          type="submit"
          className="w-full rounded-full bg-zinc-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Continue to confirmation
        </button>
      </form>
    </section>
  );
}
