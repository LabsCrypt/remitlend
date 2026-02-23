/**
 * hooks/useApi.ts
 *
 * Custom hooks for data fetching using TanStack Query.
 * Each hook wraps a specific API endpoint with caching,
 * loading states, and error handling built in.
 *
 * Base URL is read from NEXT_PUBLIC_API_URL environment variable.
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
  type UseMutationOptions,
} from "@tanstack/react-query";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

// ─── Query key factory ────────────────────────────────────────────────────────

/**
 * Centralised query key factory.
 * Using structured keys makes targeted cache invalidation easy.
 *
 * Usage:
 *   queryKeys.loans.all()       → ["loans"]
 *   queryKeys.loans.detail(id)  → ["loans", id]
 */
export const queryKeys = {
  loans: {
    all: () => ["loans"] as const,
    detail: (id: string) => ["loans", id] as const,
  },
  remittances: {
    all: () => ["remittances"] as const,
    detail: (id: string) => ["remittances", id] as const,
  },
  user: {
    profile: () => ["user", "profile"] as const,
    balance: () => ["user", "balance"] as const,
  },
} as const;

// ─── Base fetch helper ────────────────────────────────────────────────────────

/**
 * Thin fetch wrapper that:
 * - Prepends the API base URL
 * - Sets JSON Content-Type
 * - Throws a descriptive error on non-2xx responses
 */
async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(error.message ?? `Request failed with status ${response.status}`);
  }

  return response.json() as Promise<T>;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Loan {
  id: string;
  amount: number;
  currency: string;
  interestRate: number;
  termDays: number;
  status: "pending" | "active" | "repaid" | "defaulted";
  borrowerId: string;
  createdAt: string;
}

export interface Remittance {
  id: string;
  amount: number;
  fromCurrency: string;
  toCurrency: string;
  recipientAddress: string;
  status: "pending" | "processing" | "completed" | "failed";
  createdAt: string;
}

export interface UserProfile {
  id: string;
  email: string;
  walletAddress?: string;
  kycVerified: boolean;
}

export interface UserBalance {
  available: number;
  locked: number;
  currency: string;
}

// ─── Loan hooks ───────────────────────────────────────────────────────────────

/**
 * Fetches all loans.
 * Data is cached for 60s (inherits QueryClient default staleTime).
 */
export function useLoans(options?: Omit<UseQueryOptions<Loan[]>, "queryKey" | "queryFn">) {
  return useQuery<Loan[]>({
    queryKey: queryKeys.loans.all(),
    queryFn: () => apiFetch<Loan[]>("/loans"),
    ...options,
  });
}

/**
 * Fetches a single loan by ID.
 * Only runs when a valid id is provided.
 */
export function useLoan(
  id: string | undefined,
  options?: Omit<UseQueryOptions<Loan>, "queryKey" | "queryFn">,
) {
  return useQuery<Loan>({
    queryKey: queryKeys.loans.detail(id ?? ""),
    queryFn: () => apiFetch<Loan>(`/loans/${id}`),
    enabled: !!id,
    ...options,
  });
}

/**
 * Creates a new loan application.
 * Automatically invalidates the loans list cache on success.
 */
export function useCreateLoan(
  options?: UseMutationOptions<Loan, Error, Omit<Loan, "id" | "createdAt" | "status">>,
) {
  const queryClient = useQueryClient();

  return useMutation<Loan, Error, Omit<Loan, "id" | "createdAt" | "status">>({
    mutationFn: (data) =>
      apiFetch<Loan>("/loans", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      // Invalidate the loans list so it refetches with the new entry
      queryClient.invalidateQueries({ queryKey: queryKeys.loans.all() });
    },
    ...options,
  });
}

// ─── Remittance hooks ─────────────────────────────────────────────────────────

/**
 * Fetches all remittances.
 */
export function useRemittances(
  options?: Omit<UseQueryOptions<Remittance[]>, "queryKey" | "queryFn">,
) {
  return useQuery<Remittance[]>({
    queryKey: queryKeys.remittances.all(),
    queryFn: () => apiFetch<Remittance[]>("/remittances"),
    ...options,
  });
}

/**
 * Fetches a single remittance by ID.
 */
export function useRemittance(
  id: string | undefined,
  options?: Omit<UseQueryOptions<Remittance>, "queryKey" | "queryFn">,
) {
  return useQuery<Remittance>({
    queryKey: queryKeys.remittances.detail(id ?? ""),
    queryFn: () => apiFetch<Remittance>(`/remittances/${id}`),
    enabled: !!id,
    ...options,
  });
}

/**
 * Creates a new remittance.
 * Invalidates the remittances list cache on success.
 */
export function useCreateRemittance(
  options?: UseMutationOptions<Remittance, Error, Omit<Remittance, "id" | "createdAt" | "status">>,
) {
  const queryClient = useQueryClient();

  return useMutation<Remittance, Error, Omit<Remittance, "id" | "createdAt" | "status">>({
    mutationFn: (data) =>
      apiFetch<Remittance>("/remittances", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.remittances.all() });
    },
    ...options,
  });
}

// ─── User hooks ───────────────────────────────────────────────────────────────

/**
 * Fetches the current user's profile.
 */
export function useUserProfile(
  options?: Omit<UseQueryOptions<UserProfile>, "queryKey" | "queryFn">,
) {
  return useQuery<UserProfile>({
    queryKey: queryKeys.user.profile(),
    queryFn: () => apiFetch<UserProfile>("/user/profile"),
    ...options,
  });
}

/**
 * Fetches the current user's wallet balance.
 */
export function useUserBalance(
  options?: Omit<UseQueryOptions<UserBalance>, "queryKey" | "queryFn">,
) {
  return useQuery<UserBalance>({
    queryKey: queryKeys.user.balance(),
    queryFn: () => apiFetch<UserBalance>("/user/balance"),
    ...options,
  });
}
