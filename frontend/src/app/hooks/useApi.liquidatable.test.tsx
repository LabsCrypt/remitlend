import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  normalizeLiquidatableLoan,
  useLiquidatableLoans,
  type RawLiquidatableLoan,
} from "./useApi";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("normalizeLiquidatableLoan (#1889)", () => {
  it("preserves healthFactor === 0 and does not replace it with collateralRatio", () => {
    const raw: RawLiquidatableLoan = {
      loanId: 42,
      borrower: "GBD_BORROWER_1",
      collateral: 0,
      totalDebt: 5000,
      healthFactor: 0,
      collateralRatio: 1.25,
      liquidationThreshold: 1.1,
      source: "backend",
    };

    const normalized = normalizeLiquidatableLoan(raw);

    // healthFactor must remain strictly 0, NOT replaced by collateralRatio 1.25
    expect(normalized.healthFactor).toBe(0);
    expect(normalized.collateralRatio).toBe(1.25);
  });

  it("preserves collateralRatio === 0 and does not replace it with healthFactor", () => {
    const raw: RawLiquidatableLoan = {
      loanId: 43,
      borrower: "GBD_BORROWER_2",
      collateral: 0,
      totalDebt: 3000,
      healthFactor: 0.85,
      collateralRatio: 0,
      liquidationThreshold: 1.1,
      source: "contract",
    };

    const normalized = normalizeLiquidatableLoan(raw);

    expect(normalized.healthFactor).toBe(0.85);
    expect(normalized.collateralRatio).toBe(0);
    expect(normalized.source).toBe("contract");
  });

  it("preserves both when both are legitimately 0", () => {
    const raw: RawLiquidatableLoan = {
      loanId: 44,
      borrower: "GBD_BORROWER_3",
      collateral: 0,
      totalDebt: 1000,
      healthFactor: 0,
      collateralRatio: 0,
      liquidationThreshold: 1.0,
    };

    const normalized = normalizeLiquidatableLoan(raw);

    expect(normalized.healthFactor).toBe(0);
    expect(normalized.collateralRatio).toBe(0);
  });

  it("falls back to collateralRatio when healthFactor is missing or undefined", () => {
    const raw: RawLiquidatableLoan = {
      id: 45,
      borrower_address: "GBD_BORROWER_4",
      collateral_locked: 2000,
      total_debt: 1500,
      collateral_ratio: 1.33,
      liquidation_threshold: 1.15,
    };

    const normalized = normalizeLiquidatableLoan(raw);

    expect(normalized.loanId).toBe(45);
    expect(normalized.borrower).toBe("GBD_BORROWER_4");
    expect(normalized.collateral).toBe(2000);
    expect(normalized.totalDebt).toBe(1500);
    expect(normalized.healthFactor).toBe(1.33);
    expect(normalized.collateralRatio).toBe(1.33);
    expect(normalized.liquidationThreshold).toBe(1.15);
    expect(normalized.source).toBe("backend");
  });

  it("falls back to healthFactor when collateralRatio is missing or undefined", () => {
    const raw: RawLiquidatableLoan = {
      loan_id: 46,
      borrower: "GBD_BORROWER_5",
      collateral: 500,
      total_owed: 600,
      health: 0.78,
      threshold: 1.05,
    };

    const normalized = normalizeLiquidatableLoan(raw);

    expect(normalized.loanId).toBe(46);
    expect(normalized.healthFactor).toBe(0.78);
    expect(normalized.collateralRatio).toBe(0.78);
    expect(normalized.liquidationThreshold).toBe(1.05);
  });

  it("falls back to 0 when one is legitimately 0 and the other is missing", () => {
    const raw: RawLiquidatableLoan = {
      id: 47,
      borrower: "GBD_BORROWER_6",
      healthFactor: 0,
    };

    const normalized = normalizeLiquidatableLoan(raw);

    expect(normalized.healthFactor).toBe(0);
    expect(normalized.collateralRatio).toBe(0);
  });

  it("handles string numeric values including string '0'", () => {
    const raw: RawLiquidatableLoan = {
      loanId: "48",
      borrower: "GBD_BORROWER_7",
      collateral: "1000",
      totalDebt: "800",
      healthFactor: "0",
      collateralRatio: "1.25",
      liquidationThreshold: "1.1",
    };

    const normalized = normalizeLiquidatableLoan(raw);

    expect(normalized.loanId).toBe(48);
    expect(normalized.healthFactor).toBe(0);
    expect(normalized.collateralRatio).toBe(1.25);
  });
});

describe("useLiquidatableLoans integration (#1889)", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("returns liquidatable loans with 0 healthFactor preserved", async () => {
    const mockApiResponse = {
      success: true,
      data: [
        {
          loanId: 10,
          borrower: "GBD_LIQUIDATABLE_BORROWER",
          collateral: 0,
          totalDebt: 10000,
          healthFactor: 0,
          collateralRatio: 1.15,
          liquidationThreshold: 1.2,
          source: "contract",
        },
      ],
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockApiResponse,
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useLiquidatableLoans(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toBeDefined();
    expect(result.current.data).toHaveLength(1);
    const loan = result.current.data![0];
    expect(loan.loanId).toBe(10);
    expect(loan.healthFactor).toBe(0);
    expect(loan.collateralRatio).toBe(1.15);
    expect(loan.source).toBe("contract");
  });
});
