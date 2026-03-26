"use client";

import React, { Component, type ErrorInfo, type ReactNode } from "react";
import Link from "next/link";
import { RefreshCcw, Siren, TriangleAlert } from "lucide-react";

interface ErrorBoundaryProps {
  children: ReactNode;
  scope?: string;
  variant?: "page" | "section";
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

interface ErrorFallbackProps {
  error?: Error | null;
  onRetry: () => void;
  scope?: string;
  variant?: "page" | "section";
}

const REPORT_ISSUE_URL = "https://github.com/LabsCrypt/remitlend/issues/new";

export function ErrorFallback({
  error,
  onRetry,
  scope = "section",
  variant = "section",
}: ErrorFallbackProps) {
  const isPage = variant === "page";

  return (
    <div
      className={
        isPage
          ? "flex min-h-[70vh] items-center justify-center px-4 py-10"
          : "rounded-3xl border border-rose-200 bg-rose-50/70 p-6 shadow-sm dark:border-rose-900/60 dark:bg-rose-950/20"
      }
      role="alert"
      aria-live="assertive"
    >
      <div
        className={
          isPage
            ? "mx-auto max-w-xl rounded-[2rem] border border-zinc-200 bg-white p-8 text-center shadow-lg shadow-zinc-200/60 dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-none"
            : "flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between"
        }
      >
        <div className={isPage ? "space-y-5" : "flex gap-4"}>
          <div
            className={
              isPage
                ? "mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300"
                : "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300"
            }
            aria-hidden="true"
          >
            {isPage ? <Siren className="h-8 w-8" /> : <TriangleAlert className="h-6 w-6" />}
          </div>
          <div className={isPage ? "space-y-3" : "space-y-2"}>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
              Something went wrong
            </h1>
            <p className="max-w-lg text-sm leading-6 text-zinc-600 dark:text-zinc-400">
              {`The ${scope} hit an unexpected runtime error. You can reset this area and keep using the rest of RemitLend.`}
            </p>
            {error?.message ? (
              <p className="rounded-2xl border border-zinc-200 bg-zinc-100 px-4 py-3 font-mono text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                {error.message}
              </p>
            ) : null}
          </div>
        </div>

        <div
          className={
            isPage
              ? "flex flex-col items-center justify-center gap-3 pt-2 sm:flex-row"
              : "flex flex-wrap items-center gap-3"
          }
        >
          <button
            onClick={onRetry}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            <RefreshCcw className="h-4 w-4" />
            Try Again
          </button>
          <Link
            href={REPORT_ISSUE_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center rounded-full border border-zinc-300 px-5 py-2.5 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:border-zinc-500 dark:hover:bg-zinc-900"
          >
            Report this issue
          </Link>
        </div>
      </div>
    </div>
  );
}

/**
 * ErrorBoundary catches JavaScript errors anywhere in its child component tree
 * and displays a fallback UI instead of crashing the entire application.
 *
 * Must be a class component — React does not yet support error boundaries
 * as functional components.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <ErrorFallback
          error={this.state.error}
          onRetry={this.handleReset}
          scope={this.props.scope}
          variant={this.props.variant}
        />
      );
    }

    return this.props.children;
  }
}
