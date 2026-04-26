/**
 * hooks/useApi.ts
 *
 * Custom hooks for data fetching using TanStack Query.
 * Each hook wraps a specific API endpoint with caching,
 * loading states, and error handling built in.
 *
 * Base URL is read from NEXT_PUBLIC_API_URL environment variable.
 */

import { useEffect, useState } from "react";
import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
  type UseQueryOptions,
  type UseMutationOptions,
} from "@tanstack/react-query";
import { useUserStore } from "../stores/useUserStore";
import { isJwtExpired, logoutUser, SessionExpiredError } from "../lib/session";

export class NetworkUnavailableError extends Error {
  name = "NetworkUnavailableError";
}

// NEXT_PUBLIC_API_URL is required in production.
// In development it falls back to localhost — but never silently in production.
function resolveApiUrl(): string {
  const url = process.env.NEXT_PUBLIC_API_URL;

  if (!url) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "[remitlend] NEXT_PUBLIC_API_URL is required in production but was not set. " +
          "Add it to your deployment environment variables.",
      );
    }
    console.warn(
      "[remitlend] NEXT_PUBLIC_API_URL is not set. " +
        "Falling back to http://localhost:3001 (development only).",
    );
    return "http://localhost:3001";
  }

  return url;
}

let cachedApiUrl: string | null = null;
function getApiUrl(): string {
  if (cachedApiUrl !== null) return cachedApiUrl;
  cachedApiUrl = resolveApiUrl();
  return cachedApiUrl;
}

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
    config: () => ["loans", "config"] as const,
    borrowerPage: (address: string, params: Record<string, unknown>) =>
      ["loans", "borrower", address, params] as const,
  },
  remittances: {
    all: () => ["remittances"] as const,
    detail: (id: string) => ["remittances", id] as const,
    page: (params: Record<string, unknown>) => ["remittances", "page", params] as const,
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
  pool: {
    stats: () => ["pool", "stats"] as const,
    depositor: (address: string) => ["pool", "depositor", address] as const,
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
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new NetworkUnavailableError("You appear to be offline. Please reconnect and try again.");
  }

  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  // Attach JWT token if available (reads directly from Zustand store state,
  // safe to call outside React render since Zustand stores are singletons).
  const token = useUserStore.getState().authToken;
  if (token) {
    if (isJwtExpired(token)) {
      logoutUser("expired");
      throw new SessionExpiredError();
    }

    if (!headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${token}`);
    }
  }

  let response: Response;
  try {
    response = await fetch(`${getApiUrl()}${path}`, { ...options, headers });
  } catch (error) {
    throw new NetworkUnavailableError(
      "Network request failed. Check your connection and try again.",
    );
  }

  if (response.status === 401 && token) {
    const error = await response
      .json()
      .catch(() => ({ message: "Session expired. Please sign in again." }));
    logoutUser("expired");
    throw new SessionExpiredError(error.message);
  }

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
  memo?: string;
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

export interface CreditScoreResponse {
  success: boolean;
  userId: string;
  score: number;
  band: string;
}

export interface LoanConfig {
  minScore: number;
  maxAmount: number;
  interestRatePercent: number;
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
  status: "active" | "pending" | "repaid" | "defaulted";
  borrower: string;
  approvedAt?: string;
}

export interface LoanEvent {
  type: string;
  amount: string | number;
  timestamp: string;
  txHash?: string;
}

export interface LoanDetails {
  loanId: number;
  principal: number;
  accruedInterest: number;
  totalRepaid: number;
  totalOwed: number;
  interestRate: number;
  status: "active" | "repaid" | "defaulted" | "pending";
  requestedAt?: string;
  approvedAt?: string;
  events: LoanEvent[];
}

export interface LoanAmortizationScheduleRow {
  date: string;
  principalPortion: number;
  interestPortion: number;
  totalDue: number;
  runningBalance: number;
}

export interface LoanAmortization {
  principal: number;
  interestRateBps: number;
  termLedgers: number;
  totalInterest: number;
  totalDue: number;
  schedule: LoanAmortizationScheduleRow[];
}

interface LoanAmortizationPreviewParams {
  amount: number;
  termDays: 30 | 60 | 90;
}

export interface PoolStats {
  totalDeposits: number;
  totalOutstanding: number;
  utilizationRate: number;
  apy: number;
  activeLoansCount: number;
  poolTokenAddress?: string;
}

export interface DepositorPortfolio {
  address: string;
  depositAmount: number;
  sharePercent: number;
  estimatedYield: number;
  apy: number;
  firstDepositAt: string | null;
}

export interface LoanStats {
  totalActive: number;
  totalOwed: number;
  nextPaymentDue: string | null;
  overdueCount: number;
}

export interface CursorPageInfo {
  limit: number;
  count: number;
  nextCursor: string | null;
  hasPrevious: boolean;
  hasNext: boolean;
  total: number | null;
}

export interface PaginatedListResult<T> {
  items: T[];
  pageInfo: CursorPageInfo;
}

interface RawPageInfo {
  limit?: number;
  count?: number;
  total?: number | null;
  next_cursor?: string | null;
  has_previous?: boolean;
  has_next?: boolean;
}

interface RawPaginatedResponse<T> {
  success?: boolean;
  data: T;
  page_info?: RawPageInfo;
  total_count?: number | null;
}

interface CursorListParams {
  limit?: number;
  cursor?: string | null;
  status?: string;
}

interface BorrowerLoansPageResponse {
  success?: boolean;
  data: { borrower: string; loans: BorrowerLoan[] };
  page_info?: RawPageInfo;
  total_count?: number | null;
}

function toQueryString(params: Record<string, string | number | null | undefined>) {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }

    searchParams.set(key, String(value));
  }

  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : "";
}

function normalizePageInfo(raw?: RawPageInfo, fallbackTotal?: number | null): CursorPageInfo {
  return {
    limit: raw?.limit ?? 20,
    count: raw?.count ?? 0,
    nextCursor: raw?.next_cursor ?? null,
    hasPrevious: raw?.has_previous ?? false,
    hasNext: raw?.has_next ?? false,
    total: raw?.total ?? fallbackTotal ?? null,
  };
}

function normalizePaginatedList<T>(response: RawPaginatedResponse<T[]>): PaginatedListResult<T> {
  return {
    items: response.data ?? [],
    pageInfo: normalizePageInfo(response.page_info, response.total_count),
  };
}

async function fetchRemittancesPage(
  params: CursorListParams = {},
): Promise<PaginatedListResult<Remittance>> {
  const response = await apiFetch<RawPaginatedResponse<Remittance[]>>(
    `/remittances${toQueryString({
      limit: params.limit,
      cursor: params.cursor,
      status: params.status,
    })}`,
  );

  return normalizePaginatedList(response);
}

async function fetchAllRemittances(status?: string): Promise<Remittance[]> {
  const items: Remittance[] = [];
  let cursor: string | null = null;

  do {
    const page = await fetchRemittancesPage({ limit: 100, cursor, status });
    items.push(...page.items);
    cursor = page.pageInfo.nextCursor;
  } while (cursor);

  return items;
}

async function fetchBorrowerLoansPage(
  borrowerAddress: string,
  params: CursorListParams = {},
): Promise<PaginatedListResult<BorrowerLoan>> {
  const response = await apiFetch<BorrowerLoansPageResponse>(
    `/loans/borrower/${borrowerAddress}${toQueryString({
      limit: params.limit,
      cursor: params.cursor,
      status: params.status,
    })}`,
  );

  return {
    items: response.data?.loans ?? [],
    pageInfo: normalizePageInfo(response.page_info, response.total_count),
  };
}

async function fetchAllBorrowerLoans(
  borrowerAddress: string,
  status?: string,
): Promise<BorrowerLoan[]> {
  const items: BorrowerLoan[] = [];
  let cursor: string | null = null;

  do {
    const page = await fetchBorrowerLoansPage(borrowerAddress, {
      limit: 100,
      cursor,
      status,
    });
    items.push(...page.items);
    cursor = page.pageInfo.nextCursor;
  } while (cursor);

  return items;
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
  options?: Omit<UseQueryOptions<LoanDetails>, "queryKey" | "queryFn">,
) {
  return useQuery<LoanDetails>({
    queryKey: queryKeys.loans.detail(id ?? ""),
    queryFn: async () => {
      const response = await apiFetch<LoanDetails | { success: boolean; data: LoanDetails }>(
        `/loans/${id}`,
      );
      if (
        typeof response === "object" &&
        response !== null &&
        "success" in response &&
        "data" in response
      ) {
        return response.data;
      }
      return response;
    },
    enabled: !!id,
    ...options,
  });
}

/**
 * Fetches amortization schedule for a loan when a loan id is available.
 */
export function useLoanAmortizationSchedule(
  id: string | undefined,
  options?: Omit<UseQueryOptions<LoanAmortization>, "queryKey" | "queryFn">,
) {
  return useQuery<LoanAmortization>({
    queryKey: [...queryKeys.loans.detail(id ?? ""), "amortization"],
    queryFn: async () => {
      const response = await apiFetch<
        LoanAmortization | { success: boolean; amortization: LoanAmortization }
      >(`/loans/${id}/amortization-schedule`);

      if (
        typeof response === "object" &&
        response !== null &&
        "success" in response &&
        "amortization" in response
      ) {
        return response.amortization;
      }

      return response;
    },
    enabled: !!id,
    ...options,
  });
}

export function useLoanAmortizationPreview(
  params: LoanAmortizationPreviewParams | undefined,
  options?: Omit<UseQueryOptions<LoanAmortization>, "queryKey" | "queryFn">,
) {
  return useQuery<LoanAmortization>({
    queryKey: ["loans", "amortization-preview", params?.amount ?? 0, params?.termDays ?? 0],
    queryFn: async () => {
      const response = await apiFetch<
        LoanAmortization | { success: boolean; amortization: LoanAmortization }
      >("/loans/amortization-preview", {
        method: "POST",
        body: JSON.stringify(params),
      });

      if (
        typeof response === "object" &&
        response !== null &&
        "success" in response &&
        "amortization" in response
      ) {
        return response.amortization;
      }

      return response;
    },
    enabled: Boolean(params),
    ...options,
  });
}

/**
 * Fetches loan manager configuration used for borrower eligibility checks.
 */
export function useMinimumScore(
  options?: Omit<UseQueryOptions<LoanConfig>, "queryKey" | "queryFn">,
) {
  return useQuery<LoanConfig>({
    queryKey: queryKeys.loans.config(),
    queryFn: async () => {
      const response = await apiFetch<{ success: boolean; data: LoanConfig }>("/loans/config");
      return response.data;
    },
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
    queryFn: () => fetchAllRemittances(),
    ...options,
  });
}

export function useRemittancesPage(params: CursorListParams = {}, options?: { enabled?: boolean }) {
  return useQuery<PaginatedListResult<Remittance>>({
    queryKey: queryKeys.remittances.page({
      limit: params.limit ?? 20,
      cursor: params.cursor ?? null,
      status: params.status ?? "all",
    }),
    queryFn: () => fetchRemittancesPage(params),
    placeholderData: keepPreviousData,
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
 * Fetches the current credit score for the authenticated borrower.
 */
export function useCreditScore(
  userId: string | undefined,
  options?: Omit<UseQueryOptions<number>, "queryKey" | "queryFn">,
) {
  const queryClient = useQueryClient();
  const userData = useUserStore((s) => s.user);
  const walletAddress = userData?.walletAddress;
  const authToken = useUserStore((s) => s.authToken);

  const [previousScoreState, setPreviousScoreState] = useState<{
    walletAddress: string | undefined;
    previousScore: number | undefined;
  }>({
    walletAddress: undefined,
    previousScore: undefined,
  });

  const query = useQuery<number>({
    queryKey: ["creditScore", userId],
    queryFn: async () => {
      const response = await apiFetch<CreditScoreResponse>(`/score/${userId}`);
      return response.score;
    },
    enabled: !!userId,
    ...options,
  });

  useEffect(() => {
    if (!walletAddress || !authToken || !userId) {
      return;
    }

    let cancelled = false;
    let retryDelay = 1_000;
    let eventSource: EventSource | null = null;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (cancelled) {
        return;
      }

      const url = `${getApiUrl()}/api/events/stream?borrower=${encodeURIComponent(walletAddress)}`;
      const es = new EventSource(url, { withCredentials: true });
      eventSource = es;

      es.onopen = () => {
        retryDelay = 1_000;
      };

      es.onmessage = (event: MessageEvent<string>) => {
        try {
          const payload = JSON.parse(event.data) as {
            type?: string;
            borrower?: string;
            eventType?: string;
          };

          if (payload.type === "init") {
            return;
          }

          const scoreChangingEvent =
            payload.eventType === "LoanRepaid" || payload.eventType === "LoanDefaulted";

          if (payload.borrower === walletAddress && scoreChangingEvent) {
            const currentScore = queryClient.getQueryData<number>(["creditScore", userId]);

            setPreviousScoreState({
              walletAddress,
              previousScore: currentScore,
            });

            queryClient.invalidateQueries({
              queryKey: ["creditScore", userId],
            });
          }
        } catch {
          // Ignore malformed SSE payloads.
        }
      };

      es.onerror = () => {
        es.close();
        eventSource = null;

        if (!cancelled) {
          const delay = Math.min(retryDelay, 30_000);
          retryDelay = Math.min(retryDelay * 2, 30_000);
          retryTimeout = setTimeout(connect, delay);
        }
      };
    };

    connect();

    return () => {
      cancelled = true;
      eventSource?.close();
      if (retryTimeout) {
        clearTimeout(retryTimeout);
      }
    };
  }, [authToken, queryClient, walletAddress, userId]);

  return {
    ...query,
    previousScore:
      previousScoreState.walletAddress === walletAddress
        ? previousScoreState.previousScore
        : undefined,
  };
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

interface PoolApiResponse<T> {
  success: boolean;
  data: T;
}

/**
 * Fetches all loans for a borrower address.
 * Results are cached by address so multiple components sharing the same
 * address incur only one network request (TanStack deduplication).
 * Also computes derived stats (totals, overdue count, next deadline).
 */
export function useBorrowerLoans(borrowerAddress: string | undefined) {
  const query = useQuery<BorrowerLoan[]>({
    queryKey: queryKeys.borrowerLoans.byAddress(borrowerAddress ?? ""),
    queryFn: () => fetchAllBorrowerLoans(borrowerAddress ?? ""),
    enabled: !!borrowerAddress,
    staleTime: 30_000,
  });

  const loans = query.data ?? [];

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

export function useBorrowerLoansPage(
  borrowerAddress: string | undefined,
  params: CursorListParams = {},
  options?: { enabled?: boolean },
) {
  return useQuery<PaginatedListResult<BorrowerLoan>>({
    queryKey: queryKeys.loans.borrowerPage(borrowerAddress ?? "", {
      limit: params.limit ?? 20,
      cursor: params.cursor ?? null,
      status: params.status ?? "all",
    }),
    queryFn: () => fetchBorrowerLoansPage(borrowerAddress ?? "", params),
    enabled: !!borrowerAddress,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    ...options,
  });
}

export function usePoolStats(options?: Omit<UseQueryOptions<PoolStats>, "queryKey" | "queryFn">) {
  return useQuery<PoolStats>({
    queryKey: queryKeys.pool.stats(),
    queryFn: async () => {
      const response = await apiFetch<PoolApiResponse<PoolStats>>("/pool/stats");
      return response.data;
    },
    ...options,
  });
}

/**
 * Returns a callback that invalidates the pool stats cache, forcing a refetch.
 * Useful for SSE handlers that receive a pool-update event.
 */
export function useInvalidatePoolStats() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.pool.stats() });
  };
}

export function useDepositorPortfolio(
  address: string | undefined,
  options?: Omit<UseQueryOptions<DepositorPortfolio>, "queryKey" | "queryFn">,
) {
  return useQuery<DepositorPortfolio>({
    queryKey: queryKeys.pool.depositor(address ?? ""),
    queryFn: async () => {
      const response = await apiFetch<PoolApiResponse<DepositorPortfolio>>(
        `/pool/depositor/${address}`,
      );
      return response.data;
    },
    enabled: !!address,
    ...options,
  });
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

// ─── Optimistic mutations ─────────────────────────────────────────────────────

/**
 * Repays a loan with optimistic UI update.
 * Instantly updates the cached loan detail and borrower loans, then rolls back
 * on failure and refetches on settle to confirm server state.
 */
export function useRepayLoan() {
  const queryClient = useQueryClient();

  type RepayContext = {
    previousLoanDetail: unknown;
    previousBorrowerLoans: unknown;
    previousPoolStats: unknown;
  };

  return useMutation<
    { txHash: string },
    Error,
    { loanId: number; amount: number; borrowerAddress: string },
    RepayContext
  >({
    mutationFn: ({ loanId, amount }) =>
      apiFetch<{ txHash: string }>(`/loans/${loanId}/repay`, {
        method: "POST",
        body: JSON.stringify({ amount }),
      }),

    onMutate: async ({ loanId, amount, borrowerAddress }) => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.loans.detail(String(loanId)),
      });
      await queryClient.cancelQueries({
        queryKey: queryKeys.borrowerLoans.byAddress(borrowerAddress),
      });
      await queryClient.cancelQueries({ queryKey: queryKeys.pool.stats() });

      const previousLoanDetail = queryClient.getQueryData(queryKeys.loans.detail(String(loanId)));
      const previousBorrowerLoans = queryClient.getQueryData(
        queryKeys.borrowerLoans.byAddress(borrowerAddress),
      );
      const previousPoolStats = queryClient.getQueryData(queryKeys.pool.stats());

      // Optimistically update the loan detail
      queryClient.setQueryData(
        queryKeys.loans.detail(String(loanId)),
        (old: LoanDetails | undefined) => {
          if (!old) return old;
          const newOwed = Math.max(0, old.totalOwed - amount);
          return {
            ...old,
            totalOwed: newOwed,
            totalRepaid: old.totalRepaid + amount,
            status: newOwed <= 0 ? ("repaid" as const) : old.status,
          };
        },
      );

      return { previousLoanDetail, previousBorrowerLoans, previousPoolStats };
    },

    onError: (_error, { loanId, borrowerAddress }, context) => {
      if (context?.previousLoanDetail !== undefined) {
        queryClient.setQueryData(
          queryKeys.loans.detail(String(loanId)),
          context.previousLoanDetail,
        );
      }
      if (context?.previousBorrowerLoans !== undefined) {
        queryClient.setQueryData(
          queryKeys.borrowerLoans.byAddress(borrowerAddress),
          context.previousBorrowerLoans,
        );
      }
      if (context?.previousPoolStats !== undefined) {
        queryClient.setQueryData(queryKeys.pool.stats(), context.previousPoolStats);
      }
    },

    onSettled: (_data, _error, { loanId, borrowerAddress }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.loans.detail(String(loanId)) });
      queryClient.invalidateQueries({
        queryKey: queryKeys.borrowerLoans.byAddress(borrowerAddress),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.pool.stats() });
    },
  });
}

/**
 * Deposits to the lending pool with optimistic UI update.
 * Instantly reflects the deposit in pool stats and depositor portfolio,
 * then rolls back on failure.
 */
export function useDepositToPool() {
  const queryClient = useQueryClient();

  type DepositContext = { previousPoolStats: unknown; previousDepositor: unknown };

  return useMutation<
    { unsignedTxXdr: string; networkPassphrase: string },
    Error,
    { amount: number; depositorAddress: string; token: string },
    DepositContext
  >({
    mutationFn: ({ amount, depositorAddress, token }) =>
      apiFetch<{ unsignedTxXdr: string; networkPassphrase: string }>("/pool/build-deposit", {
        method: "POST",
        body: JSON.stringify({ amount, depositorPublicKey: depositorAddress, token }),
      }),

    onMutate: async ({ amount, depositorAddress }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.pool.stats() });
      await queryClient.cancelQueries({
        queryKey: queryKeys.pool.depositor(depositorAddress),
      });

      const previousPoolStats = queryClient.getQueryData(queryKeys.pool.stats());
      const previousDepositor = queryClient.getQueryData(
        queryKeys.pool.depositor(depositorAddress),
      );

      // Optimistically update pool stats
      queryClient.setQueryData(queryKeys.pool.stats(), (old: PoolStats | undefined) => {
        if (!old) return old;
        return { ...old, totalDeposits: old.totalDeposits + amount };
      });

      // Optimistically update depositor portfolio
      queryClient.setQueryData(
        queryKeys.pool.depositor(depositorAddress),
        (old: DepositorPortfolio | undefined) => {
          if (!old) return old;
          return { ...old, depositAmount: old.depositAmount + amount };
        },
      );

      return { previousPoolStats, previousDepositor };
    },

    onError: (_error, { depositorAddress }, context) => {
      if (context?.previousPoolStats !== undefined) {
        queryClient.setQueryData(queryKeys.pool.stats(), context.previousPoolStats);
      }
      if (context?.previousDepositor !== undefined) {
        queryClient.setQueryData(
          queryKeys.pool.depositor(depositorAddress),
          context.previousDepositor,
        );
      }
    },

    onSettled: (_data, _error, { depositorAddress }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.pool.stats() });
      queryClient.invalidateQueries({ queryKey: queryKeys.pool.depositor(depositorAddress) });
    },
  });
}

/**
 * Withdraws from the lending pool with optimistic UI update.
 * Instantly reflects the withdrawal in pool stats and depositor portfolio,
 * then rolls back on failure.
 */
export function useWithdrawFromPool() {
  const queryClient = useQueryClient();

  type WithdrawContext = { previousPoolStats: unknown; previousDepositor: unknown };

  return useMutation<
    { unsignedTxXdr: string; networkPassphrase: string },
    Error,
    { amount: number; depositorAddress: string; token: string },
    WithdrawContext
  >({
    mutationFn: ({ amount, depositorAddress, token }) =>
      apiFetch<{ unsignedTxXdr: string; networkPassphrase: string }>("/pool/build-withdraw", {
        method: "POST",
        body: JSON.stringify({ amount, depositorPublicKey: depositorAddress, token }),
      }),

    onMutate: async ({ amount, depositorAddress }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.pool.stats() });
      await queryClient.cancelQueries({
        queryKey: queryKeys.pool.depositor(depositorAddress),
      });

      const previousPoolStats = queryClient.getQueryData(queryKeys.pool.stats());
      const previousDepositor = queryClient.getQueryData(
        queryKeys.pool.depositor(depositorAddress),
      );

      // Optimistically update pool stats
      queryClient.setQueryData(queryKeys.pool.stats(), (old: PoolStats | undefined) => {
        if (!old) return old;
        return { ...old, totalDeposits: Math.max(0, old.totalDeposits - amount) };
      });

      // Optimistically update depositor portfolio
      queryClient.setQueryData(
        queryKeys.pool.depositor(depositorAddress),
        (old: DepositorPortfolio | undefined) => {
          if (!old) return old;
          return { ...old, depositAmount: Math.max(0, old.depositAmount - amount) };
        },
      );

      return { previousPoolStats, previousDepositor };
    },

    onError: (_error, { depositorAddress }, context) => {
      if (context?.previousPoolStats !== undefined) {
        queryClient.setQueryData(queryKeys.pool.stats(), context.previousPoolStats);
      }
      if (context?.previousDepositor !== undefined) {
        queryClient.setQueryData(
          queryKeys.pool.depositor(depositorAddress),
          context.previousDepositor,
        );
      }
    },

    onSettled: (_data, _error, { depositorAddress }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.pool.stats() });
      queryClient.invalidateQueries({ queryKey: queryKeys.pool.depositor(depositorAddress) });
    },
  });
}

/**
 * Submits a signed pool transaction to the Stellar network.
 */
export async function submitPoolTransaction(signedTxXdr: string) {
  return apiFetch<{ txHash: string; status: string; resultXdr?: string }>("/pool/submit", {
    method: "POST",
    body: JSON.stringify({ signedTxXdr }),
  });
}

/**
 * Submits a signed loan transaction (e.g. repayment) to the Stellar network.
 */
export async function submitLoanTransaction(signedTxXdr: string) {
  return apiFetch<{ txHash: string; status: string; resultXdr?: string }>("/loans/submit", {
    method: "POST",
    body: JSON.stringify({ signedTxXdr }),
  });
}
