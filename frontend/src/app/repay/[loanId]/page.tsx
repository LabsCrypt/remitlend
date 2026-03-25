import dynamic from "next/dynamic";

const RepaymentForm = dynamic(() => import("./RepaymentForm"), {
  ssr: false,
  loading: () => (
    <div className="h-[216px] w-full animate-pulse rounded-3xl bg-zinc-100 dark:bg-zinc-900" />
  ),
});

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

      <RepaymentForm />
    </section>
  );
}
