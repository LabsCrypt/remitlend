"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Home } from "lucide-react";

const segmentLabels: Record<string, string> = {
  borrower: "Borrower Portal",
  lender: "Lender Portal",
  loans: "Loans",
  lend: "Lender Portal",
  remittances: "Remittances",
  wallet: "Wallet",
  settings: "Settings",
  repay: "Repay",
  "ui-demo": "UI Demo",
};

function toTitleCase(value: string) {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getSegmentLabel(segment: string) {
  if (segmentLabels[segment]) {
    return segmentLabels[segment];
  }

  if (/^\d+$/.test(segment)) {
    return `#${segment}`;
  }

  return toTitleCase(segment);
}

export function Breadcrumbs() {
  const pathname = usePathname();

  if (!pathname || pathname === "/") {
    return null;
  }

  const segments = pathname.split("/").filter(Boolean);
  const items = segments.map((segment, index) => {
    const href = `/${segments.slice(0, index + 1).join("/")}`;
    const isCurrent = index === segments.length - 1;

    return {
      href,
      isCurrent,
      label: getSegmentLabel(segment),
    };
  });

  return (
    <nav
      aria-label="Breadcrumb"
      className="mb-4 overflow-x-auto rounded-2xl border border-zinc-200 bg-white/80 px-3 py-2 shadow-sm shadow-zinc-200/40 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/70 dark:shadow-none sm:mb-6 sm:px-4"
    >
      <ol className="flex min-w-max items-center gap-1 text-sm text-zinc-500 dark:text-zinc-400">
        <li>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-full px-2 py-1 font-medium text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
          >
            <Home className="h-4 w-4" />
            <span className="hidden sm:inline">Home</span>
          </Link>
        </li>
        {items.map((item) => (
          <li key={item.href} className="flex items-center gap-1">
            <ChevronRight className="h-4 w-4 shrink-0 text-zinc-400" />
            {item.isCurrent ? (
              <span
                aria-current="page"
                className="rounded-full bg-indigo-50 px-3 py-1 font-semibold text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300"
              >
                {item.label}
              </span>
            ) : (
              <Link
                href={item.href}
                className="rounded-full px-3 py-1 font-medium text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
              >
                {item.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
