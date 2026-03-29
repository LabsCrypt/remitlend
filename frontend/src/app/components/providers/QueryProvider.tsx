"use client";

/**
 * components/providers/QueryProvider.tsx
 *
 * Wraps the application with TanStack Query's QueryClientProvider.
 * Must be a client component since QueryClient is browser-side state.
 *
 * Usage: wrap your root layout children with <QueryProvider>
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useState, type ReactNode } from "react";

interface QueryProviderProps {
  children: ReactNode;
}

export function QueryProvider({ children }: QueryProviderProps) {
  /**
   * useState ensures a new QueryClient is created per component instance
   * (not shared across requests in SSR environments).
   */
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Data is considered fresh for 60 seconds — avoids unnecessary refetches
            staleTime: 60 * 1000,
            // Retry failed requests once before showing an error
            retry: 1,
            // Refetch when the browser window regains focus
            refetchOnWindowFocus: true,
          },
          mutations: {
            // Retry failed mutations once
            retry: 1,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {/* DevTools only render in development */}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
