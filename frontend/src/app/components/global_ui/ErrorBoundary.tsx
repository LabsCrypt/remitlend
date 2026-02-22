"use client";

import React, { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * ErrorBoundary catches JavaScript errors anywhere in its child component tree
 * and displays a fallback UI instead of crashing the entire application.
 *
 * Must be a class component — React does not yet support error boundaries
 * as functional components.
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
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
        <div className="flex min-h-screen flex-col items-center justify-center bg-background text-foreground px-4">
          <div className="text-center space-y-6 max-w-md mx-auto">
            {/* Warning icon */}
            <div className="text-9xl select-none" aria-hidden="true">
              ⚠️
            </div>

            <div className="-mt-4 relative z-10">
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl text-foreground">
                Something went wrong
              </h1>
              <p className="mt-4 text-gray-600 dark:text-gray-400 text-lg">
                An unexpected error occurred. You can try again or return to the
                home page.
              </p>
              {this.state.error && (
                <p className="mt-2 text-sm text-gray-500 dark:text-gray-500 font-mono break-all">
                  {this.state.error.message}
                </p>
              )}
            </div>

            <div className="pt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
              <button
                onClick={this.handleReset}
                className="inline-flex items-center justify-center rounded-lg bg-foreground text-background px-8 py-3 text-sm font-medium transition-transform hover:scale-105 hover:bg-opacity-90 focus:outline-none focus:ring-2 focus:ring-foreground focus:ring-offset-2 dark:focus:ring-offset-background"
              >
                Try Again
              </button>
              <a
                href="/"
                className="inline-flex items-center justify-center rounded-lg border border-gray-300 dark:border-gray-700 px-8 py-3 text-sm font-medium text-foreground transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-foreground focus:ring-offset-2 dark:focus:ring-offset-background"
              >
                Return Home
              </a>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
