"use client";

import { useEffect } from "react";
import { ErrorFallback } from "./ErrorBoundary";

interface RouteErrorViewProps {
  error: Error & { digest?: string };
  reset: () => void;
  scope: string;
}

export function RouteErrorView({ error, reset, scope }: RouteErrorViewProps) {
  useEffect(() => {
    console.error(`Route error in ${scope}:`, error);
  }, [error, scope]);

  return <ErrorFallback error={error} onRetry={reset} scope={scope} variant="page" />;
}
