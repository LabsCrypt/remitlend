"use client";

import React from "react";

export default function RepaymentForm() {
  return (
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
  );
}
