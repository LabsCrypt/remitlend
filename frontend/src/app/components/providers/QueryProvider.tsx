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
            staleTime: 5 * 60 * 1000, // 5 minutes: UI stays responsive with cached data
            gcTime: 30 * 60 * 1000,   // 30 minutes: Keep data in memory even when inactive
            retry: (failureCount, error: unknown) => {
              const errorMessage = error instanceof Error ? error.message : String(error);
              // Safe check for browser environment
              const isOffline = typeof window !== 'undefined' && !navigator.onLine;
              
              // Always retry on network errors or when offline
              if (isOffline || errorMessage.includes('Network') || errorMessage.includes('fetch')) {
                return true; 
              }
              
              // Standard retry for other transient errors (up to 3 times)
              return failureCount < 3;
            },
            retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
            refetchOnWindowFocus: true, // Re-validate data when user returns to tab
            refetchOnReconnect: 'always', // Force retry when connection returns
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
