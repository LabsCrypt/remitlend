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
import { LoanStatusBadge, type LoanStatus } from "../components/ui/LoanStatusBadge";
import { useUserStore } from "../stores/useUserStore";
import { isJwtExpired, logoutUser, SessionExpiredError } from "../lib/session";
import { useWallet } from "../components/providers/WalletProvider";
import { useContractToast } from "./useContractToast";

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
    events: (id: string) => ["loans", id, "events"] as const,
    config: () => ["loans", "config"] as const,
    liquidatable: () => ["loans", "liquidatable"] as const,
    borrowerPage: (address: string, params: Record<string, unknown>) =>
      ["loans", "borrower", address, params] as const,
    // Prefix key that matches all borrowerPage entries for an address regardless of pagination params
    borrowerPagePrefix: (address: string) => ["loans", "borrower", address] as const,
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
    list: (params: Record<string, unknown>) => ["notifications", params] as const,
  },
  adminDisputes: {
    all: () => ["admin", "disputes"] as const,
    detail: (id: string) => ["admin", "disputes", id] as const,
  },
  auth: {
    verify: () => ["auth", "verify"] as const,
  },
  score: {
    breakdown: (userId: string) => ["scoreBreakdown", userId] as const,
  },
  borrowerLoans: {
    byAddress: (address: string) => ["borrowerLoans", address] as const,
  },
  creditScore: {
    byUser: (userId: string) => ["creditScore", userId] as const,
  },
  creditScoreHistory: {
    byUser: (userId: string) => ["creditScoreHistory", userId] as const,
  },
  yieldHistory: {
    byUser: (userId: string, days: number) => ["yieldHistory", userId, days] as const,
  },
  remittanceNft: {
    byAddress: (walletAddress: string) => ["remittanceNft", walletAddress] as const,
  },
  notificationPreferences: {
    all: () => ["notificationPreferences"] as const,
  },
  amortization: {
    schedule: (loanId: string) => ["loans", loanId, "amortization"] as const,
    preview: (amount: number, termDays: number) =>
      ["loans", "amortization-preview", amount, termDays] as const,
  },
  pool: {
    stats: () => ["pool", "stats"] as const,
    depositor: (address: string) => ["pool", "depositor", address] as const,
  },
  transactions: {
    all: () => ["transactions"] as const,
    mine: (params: Record<string, unknown>) => ["transactions", "me", params] as const,
  },
  governance: {
    all: () => ["admin", "governance"] as const,
    pending: () => ["admin", "governance", "pending"] as const,
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
  if (token) {
    if (isJwtExpired(token)) {
      logoutUser("expired");
      throw new SessionExpiredError();
    }

    if (!headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${token}`);
    }
  }

  const response = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (response.status === 401 && token) {
    const error = await response
      .json()
      .catch(() => ({ message: "Session expired. Please sign in again." }));
    logoutUser("expired");
    throw new SessionExpiredError(error.message);
  }

  if (!response.ok) {
    // Session expiry: fire a global event so SessionExpiryHandler can intercept
    if (response.status === 401) {
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("auth:session-expired"));
      }
      throw new Error("Session expired. Please sign in again.");
    }
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
  status: LoanStatus;
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

export type UserRole = "admin" | "borrower" | "lender";

export interface AuthSession {
  publicKey?: string;
  role?: UserRole;
  scopes?: string[];
  valid: boolean;
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

export interface ScoreBreakdownMetrics {
  totalLoans: number;
  repaidOnTime: number;
  repaidLate: number;
  defaulted: number;
  totalRepaid: number;
  averageRepaymentTime: string;
  longestStreak: number;
  currentStreak: number;
}

export interface ScoreBreakdownResponse {
  success: boolean;
  userId: string;
  score: number;
  band: string;
  breakdown: ScoreBreakdownMetrics;
  history: Array<{ date: string | null; score: number; event: string }>;
}

export interface RemittanceNftMetadata {
  score: number;
  historyHash: string;
  metadataUri: string;
  defaultCount: number;
  transferCooldownRemaining: number;
  lastUpdateLedger: number;
}

interface RemittanceNftResponse {
  success: boolean;
  walletAddress: string;
  nft: RemittanceNftMetadata | null;
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
  status: LoanStatus;
  borrower: string;
  approvedAt?: string;
  latestEventType?: string;
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
  status: "active" | "repaid" | "defaulted" | "pending" | "liquidated";
  requestedAt?: string;
  approvedAt?: string;
  events: LoanEvent[];
  lateFees?: number;
  collateralLocked?: number;
  collateralRatio?: number;
  healthFactor?: number;
  liquidationThreshold?: number;
  healthSource?: "contract" | "backend";
}

export interface LiquidatableLoan {
  loanId: number;
  borrower: string;
  collateral: number;
  totalDebt: number;
  healthFactor: number;
  collateralRatio: number;
  liquidationThreshold: number;
  source: "contract" | "backend";
}

type RawLiquidatableLoan = Record<string, unknown>;

export interface AdminDisputeLoanSummary {
  loanId: number;
  principal?: number;
  accruedInterest?: number;
  totalRepaid?: number;
  totalOwed?: number;
  interestRate?: number;
  status?: LoanStatus | "disputed";
  nextPaymentDeadline?: string;
  approvedAt?: string;
}

export interface AdminDispute {
  id: string;
  loanId: number;
  borrower: string;
  reason: string;
  status: "open" | "resolved" | "rejected";
  createdAt: string;
  submittedAt?: string;
  resolution?: string;
  resolvedAt?: string;
  loan?: AdminDisputeLoanSummary;
}

type RawAdminDispute = Record<string, unknown>;

function stringFrom(value: unknown, fallback: string | undefined = ""): string | undefined {
  return typeof value === "string" ? value : fallback;
}

function numberFrom(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeDispute(row: RawAdminDispute): AdminDispute {
  const loan = row.loan;
  const normalizedLoan =
    loan && typeof loan === "object"
      ? ({
          loanId: numberFrom((loan as RawAdminDispute).loanId ?? (loan as RawAdminDispute).loan_id),
          principal:
            (loan as RawAdminDispute).principal !== undefined
              ? numberFrom((loan as RawAdminDispute).principal)
              : undefined,
          accruedInterest:
            (loan as RawAdminDispute).accruedInterest !== undefined ||
            (loan as RawAdminDispute).accrued_interest !== undefined
              ? numberFrom(
                  (loan as RawAdminDispute).accruedInterest ??
                    (loan as RawAdminDispute).accrued_interest,
                )
              : undefined,
          totalRepaid:
            (loan as RawAdminDispute).totalRepaid !== undefined ||
            (loan as RawAdminDispute).total_repaid !== undefined
              ? numberFrom(
                  (loan as RawAdminDispute).totalRepaid ?? (loan as RawAdminDispute).total_repaid,
                )
              : undefined,
          totalOwed:
            (loan as RawAdminDispute).totalOwed !== undefined ||
            (loan as RawAdminDispute).total_owed !== undefined
              ? numberFrom(
                  (loan as RawAdminDispute).totalOwed ?? (loan as RawAdminDispute).total_owed,
                )
              : undefined,
          interestRate:
            (loan as RawAdminDispute).interestRate !== undefined ||
            (loan as RawAdminDispute).interest_rate !== undefined
              ? numberFrom(
                  (loan as RawAdminDispute).interestRate ?? (loan as RawAdminDispute).interest_rate,
                )
              : undefined,
          status: stringFrom((loan as RawAdminDispute).status) as AdminDisputeLoanSummary["status"],
          nextPaymentDeadline: stringFrom(
            (loan as RawAdminDispute).nextPaymentDeadline ??
              (loan as RawAdminDispute).next_payment_deadline,
            undefined,
          ),
          approvedAt: stringFrom(
            (loan as RawAdminDispute).approvedAt ?? (loan as RawAdminDispute).approved_at,
            undefined,
          ),
        } satisfies AdminDisputeLoanSummary)
      : undefined;

  const loanId = numberFrom(row.loanId ?? row.loan_id ?? normalizedLoan?.loanId);
  return {
    id: String(row.id ?? ""),
    loanId,
    borrower: stringFrom(row.borrower ?? row.borrowerAddress ?? row.borrower_address) ?? "",
    reason: stringFrom(row.reason) ?? "",
    status: stringFrom(row.status, "open") as AdminDispute["status"],
    createdAt:
      stringFrom(row.createdAt ?? row.created_at ?? row.submittedAt ?? row.submitted_at) ?? "",
    submittedAt: stringFrom(row.submittedAt ?? row.submitted_at, undefined),
    resolution: stringFrom(row.resolution, undefined),
    resolvedAt: stringFrom(row.resolvedAt ?? row.resolved_at, undefined),
    loan: normalizedLoan ?? { loanId },
  };
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
  withdrawalCooldownLedgers?: number;
}

export interface DepositorPortfolio {
  address: string;
  depositAmount: number;
  sharePercent: number;
  estimatedYield: number;
  apy: number;
  firstDepositAt: string | null;
  lastDepositAt?: string | null;
}

export interface LoanStats {
  totalActive: number;
  totalOwed: number;
  nextPaymentDue: string | null;
  overdueCount: number;
}

export interface MyTransaction {
  id: number;
  txHash: string;
  status: string;
  submittedAt: string;
  submittedBy: string | null;
  transactionType: string;
  resultXdr?: string | null;
}

export interface GovernanceSigner {
  address: string;
  approved: boolean;
}

export interface GovernancePendingProposal {
  id: string;
  targetContract: string;
  proposedAdmin: string;
  approvalCount: number;
  threshold: number;
  executableAt: string | null;
  expiresAt: string | null;
  signers: GovernanceSigner[];
}

export interface GovernancePendingResponse {
  currentAdmin: string | null;
  targetContract: string | null;
  pendingProposal: GovernancePendingProposal | null;
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

interface CursorListParams extends Record<string, unknown> {
  limit?: number;
  cursor?: string | null;
  status?: string;
  enabled?: boolean;
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

function normalizeLiquidatableLoan(row: RawLiquidatableLoan): LiquidatableLoan {
  const healthFactor = numberFrom(row.healthFactor ?? row.health_factor ?? row.health);
  const collateralRatio = numberFrom(row.collateralRatio ?? row.collateral_ratio ?? row.ratio);

  return {
    loanId: numberFrom(row.loanId ?? row.loan_id ?? row.id),
    borrower: stringFrom(row.borrower ?? row.borrowerAddress ?? row.borrower_address) ?? "",
    collateral: numberFrom(row.collateral ?? row.collateralLocked ?? row.collateral_locked),
    totalDebt: numberFrom(row.totalDebt ?? row.total_debt ?? row.totalOwed ?? row.total_owed),
    healthFactor: healthFactor || collateralRatio,
    collateralRatio: collateralRatio || healthFactor,
    liquidationThreshold: numberFrom(
      row.liquidationThreshold ?? row.liquidation_threshold ?? row.threshold,
    ),
    source: row.source === "contract" ? "contract" : "backend",
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

async function fetchMyTransactionsPage(
  params: CursorListParams = {},
): Promise<PaginatedListResult<MyTransaction>> {
  const response = await apiFetch<RawPaginatedResponse<MyTransaction[]>>(
    `/transactions/me${toQueryString({
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
    queryKey: queryKeys.amortization.schedule(id ?? ""),
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
    queryKey: queryKeys.amortization.preview(params?.amount ?? 0, params?.termDays ?? 0),
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

export function useLiquidatableLoans(
  options?: Omit<UseQueryOptions<LiquidatableLoan[]>, "queryKey" | "queryFn">,
) {
  return useQuery<LiquidatableLoan[]>({
    queryKey: queryKeys.loans.liquidatable(),
    queryFn: async () => {
      const response = await apiFetch<
        | { success: boolean; data: RawLiquidatableLoan[]; source?: "contract" | "backend" }
        | { success: boolean; loans: RawLiquidatableLoan[]; source?: "contract" | "backend" }
        | RawLiquidatableLoan[]
      >("/loans/liquidatable");

      const loans = Array.isArray(response)
        ? response
        : "loans" in response
          ? response.loans
          : response.data;

      const fallbackSource = Array.isArray(response) ? undefined : response.source;
      return loans.map((loan) =>
        normalizeLiquidatableLoan({ source: fallbackSource ?? "backend", ...loan }),
      );
    },
    staleTime: 30_000,
    ...options,
  });
}

/**
 * Fetches chronological events for a specific loan.
 * Returns mapped LoanEvent[] for use with the LoanTimeline component.
 */
export function useLoanEvents(
  loanId: string | undefined,
  options?: Omit<UseQueryOptions<LoanEvent[]>, "queryKey" | "queryFn">,
) {
  return useQuery<LoanEvent[]>({
    queryKey: queryKeys.loans.events(loanId ?? ""),
    queryFn: async () => {
      interface RawEvent {
        event_id: number;
        event_type: string;
        amount: string;
        ledger_closed_at: string;
        tx_hash?: string;
      }
      interface LoanEventsResponse {
        success: boolean;
        data: {
          loanId: number;
          events: RawEvent[];
        };
      }
      const response = await apiFetch<LoanEventsResponse>(`/loans/${loanId}/events`);
      if (response?.success && response.data?.events) {
        return response.data.events.map((e) => ({
          type: e.event_type,
          amount: e.amount,
          timestamp: e.ledger_closed_at,
          txHash: e.tx_hash,
        }));
      }
      return [];
    },
    enabled: !!loanId,
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
  const walletAddress = useUserStore((s) => s.user?.walletAddress);

  return useMutation<Loan & { txHash?: string }, Error, Omit<Loan, "id" | "createdAt" | "status">>({
    mutationFn: (data) =>
      apiFetch<Loan & { txHash?: string }>("/loans", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.loans.all() });
      // Also invalidate borrowerLoans.byAddress so both borrower-loan lists stay consistent (#1219)
      if (walletAddress) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.borrowerLoans.byAddress(walletAddress),
        });
      }
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
    queryKey: queryKeys.creditScoreHistory.byUser(userId ?? ""),
    queryFn: () => apiFetch<CreditScoreHistory[]>(`/score/${userId}/history`),
    enabled: !!userId,
    ...options,
  });
}

export function useScoreBreakdown(
  userId: string | undefined,
  options?: Omit<UseQueryOptions<ScoreBreakdownResponse>, "queryKey" | "queryFn">,
) {
  return useQuery<ScoreBreakdownResponse>({
    queryKey: queryKeys.score.breakdown(userId ?? ""),
    queryFn: async () => apiFetch<ScoreBreakdownResponse>(`/score/${userId}/breakdown`),
    enabled: !!userId,
    ...options,
  });
}

export function useRemittanceNft(
  walletAddress: string | undefined,
  options?: Omit<UseQueryOptions<RemittanceNftMetadata | null>, "queryKey" | "queryFn">,
) {
  return useQuery<RemittanceNftMetadata | null>({
    queryKey: queryKeys.remittanceNft.byAddress(walletAddress ?? ""),
    queryFn: async () => {
      const response = await apiFetch<RemittanceNftResponse>(`/score/${walletAddress}/nft`);
      return response.nft;
    },
    enabled: !!walletAddress,
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
    queryKey: queryKeys.creditScore.byUser(userId ?? ""),
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
    let abortControllerRef: AbortController | null = null;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;

    const connect = async () => {
      if (cancelled) {
        return;
      }

      if (abortControllerRef) {
        abortControllerRef.abort();
      }

      const controller = new AbortController();
      abortControllerRef = controller;

      try {
        const url = `${API_URL}/api/events/stream?borrower=${encodeURIComponent(walletAddress)}`;
        const headers: Record<string, string> = {
          Accept: "text/event-stream",
        };

        if (token) {
          headers["Authorization"] = `Bearer ${token}`;
        }

        const response = await fetch(url, {
          headers,
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`SSE connection failed: ${response.status}`);
        }

        if (!response.body) {
          throw new Error("Response body is null");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        retryDelay = 1_000;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() || "";

          for (const part of parts) {
            const lines = part.split("\n");
            for (const line of lines) {
              if (line.startsWith("data: ")) {
                const dataStr = line.slice(6);
                try {
                  const payload = JSON.parse(dataStr) as {
                    type?: string;
                    borrower?: string;
                    eventType?: string;
                  };

                  if (payload.type === "init") {
                    continue;
                  }

                  const scoreChangingEvent =
                    payload.eventType === "LoanRepaid" || payload.eventType === "LoanDefaulted";

                  if (payload.borrower === walletAddress && scoreChangingEvent) {
                    const currentScore = queryClient.getQueryData<number>(
                      queryKeys.creditScore.byUser(userId ?? ""),
                    );

                    setPreviousScoreState({
                      walletAddress,
                      previousScore: currentScore,
                    });

                    queryClient.invalidateQueries({
                      queryKey: queryKeys.creditScore.byUser(userId ?? ""),
                    });
                  }
                } catch {
                  // Ignore malformed SSE payloads.
                }
              }
            }
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          return;
        }

        if (!cancelled) {
          const delay = Math.min(retryDelay, 30_000);
          retryDelay = Math.min(retryDelay * 2, 30_000);
          retryTimeout = setTimeout(() => void connect(), delay);
        }
      }
    };

    void connect();

    return () => {
      cancelled = true;
      if (abortControllerRef) {
        abortControllerRef.abort();
      }
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
  options?: Omit<UseQueryOptions<YieldHistory[]>, "queryKey" | "queryFn"> & {
    days?: 7 | 30 | 90;
  },
) {
  const { days = 30, ...queryOptions } = options ?? {};

  return useQuery<YieldHistory[]>({
    queryKey: queryKeys.yieldHistory.byUser(userId ?? "", days),
    queryFn: async () => {
      const response = await apiFetch<
        PoolApiResponse<
          Array<{
            date: string;
            earnings: number;
            apy: number;
            principal?: number;
          }>
        >
      >(`/pool/depositor/${userId}/yield-history?days=${days}`);
      return response.data;
    },
    enabled: !!userId,
    ...queryOptions,
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

export interface NotificationsQueryParams {
  limit?: number;
  unread?: boolean;
  type?: NotificationType | "all";
  page?: number;
}

/**
 * Fetches the authenticated user's notifications.
 * Polls every 60s as a fallback alongside the SSE stream.
 */
export function useNotifications(
  params: NotificationsQueryParams = {},
  options?: Omit<UseQueryOptions<NotificationsResponse>, "queryKey" | "queryFn">,
) {
  return useQuery<NotificationsResponse>({
    queryKey: queryKeys.notifications.list(params as Record<string, unknown>),
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      searchParams.set("limit", String(params.limit ?? 50));
      if (params.unread !== undefined) searchParams.set("unread", String(params.unread));
      if (params.type && params.type !== "all") searchParams.set("type", params.type);
      if (params.page) searchParams.set("page", String(params.page));

      const res = await apiFetch<{ success: boolean; data: NotificationsResponse }>(
        `/notifications?${searchParams.toString()}`,
      );
      return res.data;
    },
    refetchInterval: 60_000,
    ...options,
  });
}

export interface NotificationPreferences {
  emailEnabled: boolean;
  smsEnabled: boolean;
  phone: string | null;
  perTypeOverrides: Record<string, boolean>;
}

export function useNotificationPreferences(
  options?: Omit<UseQueryOptions<NotificationPreferences>, "queryKey" | "queryFn">,
) {
  return useQuery<NotificationPreferences>({
    queryKey: queryKeys.notificationPreferences.all(),
    queryFn: async () => apiFetch<NotificationPreferences>("/notifications/preferences"),
    ...options,
  });
}

export function useUpdateNotificationPreferences() {
  const queryClient = useQueryClient();
  return useMutation<NotificationPreferences, Error, NotificationPreferences>({
    mutationFn: (payload) =>
      apiFetch<NotificationPreferences>("/notifications/preferences", {
        method: "PUT",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notificationPreferences.all() });
    },
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

export function useVerifySession(
  options?: Omit<UseQueryOptions<AuthSession>, "queryKey" | "queryFn">,
) {
  return useQuery<AuthSession>({
    queryKey: queryKeys.auth.verify(),
    queryFn: async () => {
      const response = await apiFetch<{ success: boolean; data: AuthSession }>("/auth/verify");
      return response.data;
    },
    retry: false,
    ...options,
  });
}

export function useAdminDisputes(
  options?: Omit<UseQueryOptions<AdminDispute[]>, "queryKey" | "queryFn">,
) {
  return useQuery<AdminDispute[]>({
    queryKey: queryKeys.adminDisputes.all(),
    queryFn: async () => {
      const response = await apiFetch<
        | { success: boolean; disputes: RawAdminDispute[] }
        | { success: boolean; data: RawAdminDispute[] }
        | RawAdminDispute[]
      >("/admin/disputes");

      const disputes = Array.isArray(response)
        ? response
        : "disputes" in response
          ? response.disputes
          : response.data;

      return disputes.map(normalizeDispute);
    },
    refetchInterval: 60_000,
    ...options,
  });
}

export function useAdminDispute(
  id: string | undefined,
  options?: Omit<UseQueryOptions<AdminDispute>, "queryKey" | "queryFn">,
) {
  return useQuery<AdminDispute>({
    queryKey: queryKeys.adminDisputes.detail(id ?? ""),
    queryFn: async () => {
      const response = await apiFetch<
        | { success: boolean; dispute: RawAdminDispute }
        | { success: boolean; data: RawAdminDispute }
        | RawAdminDispute
      >(`/admin/disputes/${id}`);

      const dispute = (
        "dispute" in response ? response.dispute : "data" in response ? response.data : response
      ) as RawAdminDispute;
      return normalizeDispute(dispute);
    },
    enabled: !!id,
    ...options,
  });
}

export function useResolveAdminDispute() {
  const queryClient = useQueryClient();

  return useMutation<
    { success: boolean; message?: string },
    Error,
    { id: string; action: "resolve" | "reject"; note: string }
  >({
    mutationFn: ({ id, action, note }) =>
      apiFetch<{ success: boolean; message?: string }>(`/admin/disputes/${id}/${action}`, {
        method: "POST",
        body: JSON.stringify({ note, resolution: note }),
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.adminDisputes.all() });
      queryClient.invalidateQueries({ queryKey: queryKeys.adminDisputes.detail(variables.id) });
    },
  });
}

// ─── Optimistic mutations ─────────────────────────────────────────────────────

/**
 * Submits a loan repayment directly to the server and updates the cache
 * with optimistic rollback on failure.
 *
 * This hook calls `/loans/{loanId}/repay` (a full server-side build+sign+submit
 * flow). It is NOT a build-only hook — the mutation succeeds only when the
 * server has submitted the transaction on-chain and returned a `txHash`.
 * The optimistic loan-status update is rolled back automatically on error.
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
      // Also invalidate paginated borrower loans (borrowerPage) so both namespaces stay in sync (#1219)
      queryClient.invalidateQueries({
        queryKey: queryKeys.loans.borrowerPagePrefix(borrowerAddress),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.pool.stats() });
    },
  });
}

/**
 * Builds an unsigned deposit transaction XDR. Does NOT deposit — it only calls
 * `/pool/build-deposit` and returns `{ unsignedTxXdr, networkPassphrase }`.
 *
 * Callers must pair this with `signTransaction` + `submitPoolTransaction` to
 * complete the deposit (see `useDepositOperation` in useRepaymentOperation.ts).
 * The optimistic UI update fires on build success, not on-chain confirmation —
 * treat it as a UX hint only and always confirm via `onSettled` refetch.
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
 * Builds an unsigned withdrawal transaction XDR. Does NOT withdraw — it only calls
 * `/pool/build-withdraw` and returns `{ unsignedTxXdr, networkPassphrase }`.
 *
 * Callers must pair this with `signTransaction` + `submitPoolTransaction` to
 * complete the withdrawal (see `useWithdrawalOperation` in useRepaymentOperation.ts).
 * The optimistic UI update fires on build success, not on-chain confirmation —
 * treat it as a UX hint only and always confirm via `onSettled` refetch.
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

interface BuildLoanTxResponse {
  success: boolean;
  loanId: number;
  unsignedTxXdr: string;
  networkPassphrase: string;
}

export async function buildRefinanceLoanTransaction(params: {
  loanId: string | number;
  borrowerPublicKey: string;
  newAmount: number;
  newTerm: number;
}) {
  return apiFetch<BuildLoanTxResponse>(`/loans/${params.loanId}/build-refinance`, {
    method: "POST",
    body: JSON.stringify({
      borrowerPublicKey: params.borrowerPublicKey,
      newAmount: params.newAmount,
      newTerm: params.newTerm,
    }),
  });
}

export async function buildExtendLoanTransaction(params: {
  loanId: string | number;
  borrowerPublicKey: string;
  extraLedgers: number;
}) {
  return apiFetch<BuildLoanTxResponse>(`/loans/${params.loanId}/build-extend`, {
    method: "POST",
    body: JSON.stringify({
      borrowerPublicKey: params.borrowerPublicKey,
      extraLedgers: params.extraLedgers,
    }),
  });
}

export async function buildLiquidateLoanTransaction(params: {
  loanId: string | number;
  liquidatorPublicKey: string;
}) {
  return apiFetch<BuildLoanTxResponse>(`/loans/${params.loanId}/liquidate/build`, {
    method: "POST",
    body: JSON.stringify({
      liquidatorPublicKey: params.liquidatorPublicKey,
    }),
  });
}

export function useMyTransactions(params: CursorListParams = {}) {
  return useQuery({
    queryKey: queryKeys.transactions.mine(params),
    queryFn: () => fetchMyTransactionsPage(params),
    enabled: params.enabled ?? true,
    placeholderData: keepPreviousData,
  });
}

export function useAdminGovernancePending() {
  return useQuery({
    queryKey: queryKeys.governance.pending(),
    queryFn: () => apiFetch<GovernancePendingResponse>("/admin/governance/pending"),
  });
}

export async function buildDepositCollateralTransaction(params: {
  loanId: string | number;
  amount: string;
}) {
  return apiFetch<BuildLoanTxResponse>(`/loans/${params.loanId}/deposit-collateral`, {
    method: "POST",
    body: JSON.stringify({ amount: params.amount }),
  });
}

export async function buildReleaseCollateralTransaction(params: {
  loanId: string | number;
  amount: string;
}) {
  return apiFetch<BuildLoanTxResponse>(`/loans/${params.loanId}/release-collateral`, {
    method: "POST",
    body: JSON.stringify({ amount: params.amount }),
  });
}

export function useDepositCollateral() {
  const { signTransaction } = useWallet();
  const toast = useContractToast();

  return useMutation({
    mutationFn: async ({ loanId, amount }: { loanId: string; amount: string }) => {
      const { unsignedTxXdr } = await buildDepositCollateralTransaction({ loanId, amount });
      const signedTxXdr = await signTransaction(unsignedTxXdr);
      return submitLoanTransaction(signedTxXdr);
    },

    onSuccess: () => {
      toast.success("Collateral deposited successfully");
    },

    onError: (error: Error) => {
      toast.error(error.message ?? "Failed to deposit collateral");
    },
  });
}

export function useReleaseCollateral() {
  const { signTransaction } = useWallet();
  const toast = useContractToast();

  return useMutation({
    mutationFn: async ({ loanId, amount }: { loanId: string; amount: string }) => {
      const { unsignedTxXdr } = await buildReleaseCollateralTransaction({ loanId, amount });
      const signedTxXdr = await signTransaction(unsignedTxXdr);
      return submitLoanTransaction(signedTxXdr);
    },

    onSuccess: () => {
      toast.success("Collateral released successfully");
    },

    onError: (error: Error) => {
      toast.error(error.message ?? "Failed to release collateral");
    },
  });
}
