/**
 * hooks/useApi.optimisticRollback.test.tsx
 *
 * Tests for #1226: optimistic-update snapshot, rollback on error, and
 * onSettled invalidation in useRepayLoan, useDepositToPool, and
 * useWithdrawFromPool.
 */

import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  useRepayLoan,
  useDepositToPool,
  useWithdrawFromPool,
  queryKeys,
  type LoanDetails,
  type PoolStats,
  type DepositorPortfolio,
  type BorrowerLoan,
} from "./useApi";

function createTestHarness() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

function mockFetchFailure() {
  return jest.fn().mockResolvedValue({
    ok: false,
    status: 500,
    statusText: "Internal Server Error",
    json: async () => ({ message: "boom" }),
  });
}

function mockFetchSuccess<T>(data: T) {
  return jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => data,
  });
}

const BORROWER = "GBORROWER123";
const DEPOSITOR = "GDEPOSITOR456";
const LOAN_ID = 1;

const seedLoanDetail = (): LoanDetails => ({
  loanId: LOAN_ID,
  principal: 1000,
  accruedInterest: 50,
  totalRepaid: 200,
  totalOwed: 850,
  interestRate: 5,
  status: "active",
  events: [],
});

const seedBorrowerLoans = (): BorrowerLoan[] => [
  {
    id: LOAN_ID,
    principal: 1000,
    accruedInterest: 50,
    totalOwed: 850,
    totalRepaid: 200,
    nextPaymentDeadline: "2026-07-01",
    status: "active",
    borrower: BORROWER,
  },
];

const seedPoolStats = (): PoolStats => ({
  totalDeposits: 10000,
  totalOutstanding: 5000,
  utilizationRate: 0.5,
  apy: 8,
  activeLoansCount: 3,
});

const seedDepositor = (): DepositorPortfolio => ({
  address: DEPOSITOR,
  depositAmount: 500,
  sharePercent: 5,
  estimatedYield: 40,
  apy: 8,
  firstDepositAt: "2026-01-01",
});

describe("useRepayLoan optimistic rollback", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function seedRepayCache(queryClient: QueryClient) {
    const loanDetail = seedLoanDetail();
    const borrowerLoans = seedBorrowerLoans();
    const poolStats = seedPoolStats();

    queryClient.setQueryData(queryKeys.loans.detail(String(LOAN_ID)), loanDetail);
    queryClient.setQueryData(queryKeys.borrowerLoans.byAddress(BORROWER), borrowerLoans);
    queryClient.setQueryData(queryKeys.pool.stats(), poolStats);

    return { loanDetail, borrowerLoans, poolStats };
  }

  it("onMutate updates loan detail optimistically while pending", async () => {
    global.fetch = mockFetchSuccess({ txHash: "abc" }) as unknown as typeof fetch;
    const { queryClient, wrapper } = createTestHarness();
    seedRepayCache(queryClient);

    const { result } = renderHook(() => useRepayLoan(), { wrapper });

    result.current.mutate({ loanId: LOAN_ID, amount: 100, borrowerAddress: BORROWER });

    await waitFor(() => {
      const cached = queryClient.getQueryData<LoanDetails>(queryKeys.loans.detail(String(LOAN_ID)));
      expect(cached?.totalOwed).toBe(750);
      expect(cached?.totalRepaid).toBe(300);
      expect(cached?.status).toBe("active");
    });
  });

  it("onMutate flips status to repaid when repayment covers totalOwed", async () => {
    global.fetch = mockFetchSuccess({ txHash: "abc" }) as unknown as typeof fetch;
    const { queryClient, wrapper } = createTestHarness();
    seedRepayCache(queryClient);

    const { result } = renderHook(() => useRepayLoan(), { wrapper });

    result.current.mutate({ loanId: LOAN_ID, amount: 850, borrowerAddress: BORROWER });

    await waitFor(() => {
      const cached = queryClient.getQueryData<LoanDetails>(queryKeys.loans.detail(String(LOAN_ID)));
      expect(cached?.totalOwed).toBe(0);
      expect(cached?.totalRepaid).toBe(1050);
      expect(cached?.status).toBe("repaid");
    });
  });

  it("onError restores exact previous loan detail, borrower loans, and pool stats", async () => {
    global.fetch = mockFetchFailure() as unknown as typeof fetch;
    const { queryClient, wrapper } = createTestHarness();
    const { loanDetail, borrowerLoans, poolStats } = seedRepayCache(queryClient);

    const { result } = renderHook(() => useRepayLoan(), { wrapper });

    result.current.mutate({ loanId: LOAN_ID, amount: 100, borrowerAddress: BORROWER });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(queryClient.getQueryData(queryKeys.loans.detail(String(LOAN_ID)))).toEqual(loanDetail);
    expect(queryClient.getQueryData(queryKeys.borrowerLoans.byAddress(BORROWER))).toEqual(
      borrowerLoans,
    );
    expect(queryClient.getQueryData(queryKeys.pool.stats())).toEqual(poolStats);
  });

  it("onSettled invalidates loans.detail, borrowerLoans.byAddress, and pool.stats", async () => {
    global.fetch = mockFetchSuccess({ txHash: "abc" }) as unknown as typeof fetch;
    const { queryClient, wrapper } = createTestHarness();
    seedRepayCache(queryClient);
    const invalidateSpy = jest.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useRepayLoan(), { wrapper });

    result.current.mutate({ loanId: LOAN_ID, amount: 100, borrowerAddress: BORROWER });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.loans.detail(String(LOAN_ID)),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.borrowerLoans.byAddress(BORROWER),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.pool.stats() });
  });
});

describe("useWithdrawFromPool optimistic rollback", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function seedWithdrawCache(queryClient: QueryClient) {
    const poolStats = seedPoolStats();
    const depositor = seedDepositor();

    queryClient.setQueryData(queryKeys.pool.stats(), poolStats);
    queryClient.setQueryData(queryKeys.pool.depositor(DEPOSITOR), depositor);

    return { poolStats, depositor };
  }

  it("onMutate subtracts a normal withdrawal from pool and depositor totals", async () => {
    global.fetch = mockFetchSuccess({
      unsignedTxXdr: "xdr",
      networkPassphrase: "pass",
    }) as unknown as typeof fetch;
    const { queryClient, wrapper } = createTestHarness();
    seedWithdrawCache(queryClient);

    const { result } = renderHook(() => useWithdrawFromPool(), { wrapper });

    result.current.mutate({
      amount: 50,
      depositorAddress: DEPOSITOR,
      token: "USDC",
    });

    await waitFor(() => {
      const cachedStats = queryClient.getQueryData<PoolStats>(queryKeys.pool.stats());
      const cachedDepositor = queryClient.getQueryData<DepositorPortfolio>(
        queryKeys.pool.depositor(DEPOSITOR),
      );
      expect(cachedStats?.totalDeposits).toBe(9950);
      expect(cachedDepositor?.depositAmount).toBe(450);
    });
  });

  it("onMutate clamps depositAmount and totalDeposits at 0 when withdrawal exceeds balance", async () => {
    global.fetch = mockFetchSuccess({
      unsignedTxXdr: "xdr",
      networkPassphrase: "pass",
    }) as unknown as typeof fetch;
    const { queryClient, wrapper } = createTestHarness();
    queryClient.setQueryData(queryKeys.pool.stats(), { ...seedPoolStats(), totalDeposits: 30 });
    queryClient.setQueryData(queryKeys.pool.depositor(DEPOSITOR), {
      ...seedDepositor(),
      depositAmount: 30,
    });

    const { result } = renderHook(() => useWithdrawFromPool(), { wrapper });

    result.current.mutate({
      amount: 100,
      depositorAddress: DEPOSITOR,
      token: "USDC",
    });

    await waitFor(() => {
      const cachedDepositor = queryClient.getQueryData<DepositorPortfolio>(
        queryKeys.pool.depositor(DEPOSITOR),
      );
      const cachedStats = queryClient.getQueryData<PoolStats>(queryKeys.pool.stats());
      expect(cachedDepositor?.depositAmount).toBe(0);
      expect(cachedStats?.totalDeposits).toBe(0);
    });
  });

  it("onError restores exact previous pool stats and depositor portfolio", async () => {
    global.fetch = mockFetchFailure() as unknown as typeof fetch;
    const { queryClient, wrapper } = createTestHarness();
    const { poolStats, depositor } = seedWithdrawCache(queryClient);

    const { result } = renderHook(() => useWithdrawFromPool(), { wrapper });

    result.current.mutate({
      amount: 50,
      depositorAddress: DEPOSITOR,
      token: "USDC",
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(queryClient.getQueryData(queryKeys.pool.stats())).toEqual(poolStats);
    expect(queryClient.getQueryData(queryKeys.pool.depositor(DEPOSITOR))).toEqual(depositor);
  });

  it("onSettled invalidates pool.stats and pool.depositor", async () => {
    global.fetch = mockFetchSuccess({
      unsignedTxXdr: "xdr",
      networkPassphrase: "pass",
    }) as unknown as typeof fetch;
    const { queryClient, wrapper } = createTestHarness();
    seedWithdrawCache(queryClient);
    const invalidateSpy = jest.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useWithdrawFromPool(), { wrapper });

    result.current.mutate({
      amount: 50,
      depositorAddress: DEPOSITOR,
      token: "USDC",
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.pool.stats() });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.pool.depositor(DEPOSITOR),
    });
  });
});

describe("useDepositToPool optimistic rollback", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("onMutate increases pool stats and depositor depositAmount optimistically", async () => {
    global.fetch = mockFetchSuccess({
      unsignedTxXdr: "xdr",
      networkPassphrase: "pass",
    }) as unknown as typeof fetch;
    const { queryClient, wrapper } = createTestHarness();
    const poolStats = seedPoolStats();
    const depositor = seedDepositor();
    queryClient.setQueryData(queryKeys.pool.stats(), poolStats);
    queryClient.setQueryData(queryKeys.pool.depositor(DEPOSITOR), depositor);

    const { result } = renderHook(() => useDepositToPool(), { wrapper });

    result.current.mutate({
      amount: 200,
      depositorAddress: DEPOSITOR,
      token: "USDC",
    });

    await waitFor(() => {
      const cachedStats = queryClient.getQueryData<PoolStats>(queryKeys.pool.stats());
      const cachedDepositor = queryClient.getQueryData<DepositorPortfolio>(
        queryKeys.pool.depositor(DEPOSITOR),
      );
      expect(cachedStats?.totalDeposits).toBe(10200);
      expect(cachedDepositor?.depositAmount).toBe(700);
    });
  });

  it("onError restores exact previous pool stats and depositor portfolio", async () => {
    global.fetch = mockFetchFailure() as unknown as typeof fetch;
    const { queryClient, wrapper } = createTestHarness();
    const poolStats = seedPoolStats();
    const depositor = seedDepositor();
    queryClient.setQueryData(queryKeys.pool.stats(), poolStats);
    queryClient.setQueryData(queryKeys.pool.depositor(DEPOSITOR), depositor);

    const { result } = renderHook(() => useDepositToPool(), { wrapper });

    result.current.mutate({
      amount: 200,
      depositorAddress: DEPOSITOR,
      token: "USDC",
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(queryClient.getQueryData(queryKeys.pool.stats())).toEqual(poolStats);
    expect(queryClient.getQueryData(queryKeys.pool.depositor(DEPOSITOR))).toEqual(depositor);
  });
});
