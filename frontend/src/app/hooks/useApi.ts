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
import { useUserStore } from "../stores/useUserStore";

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
  notifications: {
    all: () => ["notifications"] as const,
  },
  borrowerLoans: {
    byAddress: (address: string) => ["borrowerLoans", address] as const,
  },
} as const;

// ─── Base fetch helper ────────────────────────────────────────────────────────

/**
 * Thin fetch wrapper that:
 * - Prepends the API base URL
 * - Sets JSON Content-Type
 * - Attaches the JWT Bearer token when one is stored
 * - Throws a descriptive error on non-2xx responses
 */
async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  // Attach JWT token if available (reads directly from Zustand store state,
  // safe to call outside React render since Zustand stores are singletons).
  const token = useUserStore.getState().authToken;
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
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

export interface CreditScoreHistory {
  date: string;
  score: number;
  event?: string;
}

export interface YieldHistory {
  date: string;
  earnings: number;
  apy: number;
  principal?: number;
}

export interface BorrowerLoan {
  id: number;
  principal: number;
  accruedInterest: number;
  totalOwed: number;
  totalRepaid: number;
  nextPaymentDeadline: string;
  status: "active" | "pending" | "repaid";
  borrower: string;
  approvedAt?: string;
}

export interface LoanStats {
  totalActive: number;
  totalOwed: number;
  nextPaymentDue: string | null;
  overdueCount: number;
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
 * Returns mutation with txHash in the response for toast integration.
 */
export function useCreateLoan(
  options?: UseMutationOptions<
    Loan & { txHash?: string },
    Error,
    Omit<Loan, "id" | "createdAt" | "status">
  >,
) {
  const queryClient = useQueryClient();

  return useMutation<Loan & { txHash?: string }, Error, Omit<Loan, "id" | "createdAt" | "status">>({
    mutationFn: (data) =>
      apiFetch<Loan & { txHash?: string }>("/loans", {
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
 * Returns mutation with txHash in the response for toast integration.
 */
export function useCreateRemittance(
  options?: UseMutationOptions<
    Remittance & { txHash?: string },
    Error,
    Omit<Remittance, "id" | "createdAt" | "status">
  >,
) {
  const queryClient = useQueryClient();

  return useMutation<
    Remittance & { txHash?: string },
    Error,
    Omit<Remittance, "id" | "createdAt" | "status">
  >({
    mutationFn: (data) =>
      apiFetch<Remittance & { txHash?: string }>("/remittances", {
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

// ─── Chart data hooks ─────────────────────────────────────────────────────────

/**
 * Fetches credit score history for trend visualization.
 * Returns historical score data points over time.
 */
export function useCreditScoreHistory(
  userId: string | undefined,
  options?: Omit<UseQueryOptions<CreditScoreHistory[]>, "queryKey" | "queryFn">,
) {
  return useQuery<CreditScoreHistory[]>({
    queryKey: ["creditScoreHistory", userId],
    queryFn: () => apiFetch<CreditScoreHistory[]>(`/score/${userId}/history`),
    enabled: !!userId,
    ...options,
  });
}

/**
 * Fetches yield earnings history for lenders.
 * Returns historical yield performance data.
 */
export function useYieldHistory(
  userId: string | undefined,
  options?: Omit<UseQueryOptions<YieldHistory[]>, "queryKey" | "queryFn">,
) {
  return useQuery<YieldHistory[]>({
    queryKey: ["yieldHistory", userId],
    queryFn: () => apiFetch<YieldHistory[]>(`/yield/${userId}/history`),
    enabled: !!userId,
    ...options,
  });
}

// ─── Borrower loans hook ──────────────────────────────────────────────────────

interface BorrowerLoansApiResponse {
  success: boolean;
  data: { borrower: string; loans: BorrowerLoan[]; totalLoans: number };
}

/**
 * Fetches all loans for a borrower address.
 * Results are cached by address so multiple components sharing the same
 * address incur only one network request (TanStack deduplication).
 * Also computes derived stats (totals, overdue count, next deadline).
 */
export function useBorrowerLoans(borrowerAddress: string | undefined) {
  const query = useQuery<BorrowerLoansApiResponse>({
    queryKey: queryKeys.borrowerLoans.byAddress(borrowerAddress ?? ""),
    queryFn: () => apiFetch<BorrowerLoansApiResponse>(`/loans/borrower/${borrowerAddress}`),
    enabled: !!borrowerAddress,
    staleTime: 30_000,
  });

  const loans = query.data?.data.loans ?? [];

  const activeLoans = loans.filter((l) => l.status === "active");
  const now = new Date();
  const overdueLoans = activeLoans.filter((l) => new Date(l.nextPaymentDeadline) < now);
  const upcomingDeadlines = activeLoans
    .filter((l) => new Date(l.nextPaymentDeadline) >= now)
    .sort(
      (a, b) =>
        new Date(a.nextPaymentDeadline).getTime() - new Date(b.nextPaymentDeadline).getTime(),
    );

  const stats: LoanStats = {
    totalActive: activeLoans.length,
    totalOwed: activeLoans.reduce((sum, l) => sum + l.totalOwed, 0),
    nextPaymentDue: upcomingDeadlines[0]?.nextPaymentDeadline ?? null,
    overdueCount: overdueLoans.length,
  };

  return { ...query, loans, stats };
}

// ─── Notification types & hooks ───────────────────────────────────────────────

export type NotificationType =
  | "loan_approved"
  | "repayment_due"
  | "repayment_confirmed"
  | "loan_defaulted"
  | "score_changed";

export interface AppNotification {
  id: number;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  loanId?: number;
  read: boolean;
  createdAt: string;
}

interface NotificationsResponse {
  notifications: AppNotification[];
  unreadCount: number;
}

/**
 * Fetches the authenticated user's notifications.
 * Polls every 60s as a fallback alongside the SSE stream.
 */
export function useNotifications(
  options?: Omit<UseQueryOptions<NotificationsResponse>, "queryKey" | "queryFn">,
) {
  return useQuery<NotificationsResponse>({
    queryKey: queryKeys.notifications.all(),
    queryFn: async () => {
      const res = await apiFetch<{ success: boolean; data: NotificationsResponse }>(
        "/notifications?limit=50",
      );
      return res.data;
    },
    refetchInterval: 60_000,
    ...options,
  });
}

/**
 * Marks specific notifications as read.
 */
export function useMarkNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, number[]>({
    mutationFn: (ids) =>
      apiFetch<void>("/notifications/mark-read", {
        method: "POST",
        body: JSON.stringify({ ids }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all() });
    },
  });
}

/**
 * Marks all notifications as read.
 */
export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, void>({
    mutationFn: () => apiFetch<void>("/notifications/mark-all-read", { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all() });
    },
  });
}
