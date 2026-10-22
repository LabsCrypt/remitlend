import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useLiquidatableLoans, queryKeys } from "./useApi";

function createTestHarness() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe("useLiquidatableLoans", () => {
  it("preserves healthFactor === 0 instead of replacing it with collateralRatio", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        loans: [
          {
            loanId: 1,
            borrower: "GBORROWER1",
            collateral: 0,
            totalDebt: 1000,
            healthFactor: 0,
            collateralRatio: 0,
            liquidationThreshold: 0.8,
            source: "backend",
          },
        ],
        source: "backend",
      }),
    });
    (globalThis as any).fetch = fetchMock;

    const { result } = renderHook(() => useLiquidatableLoans(), {
      wrapper: createTestHarness().wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([
      expect.objectContaining({
        loanId: 1,
        healthFactor: 0,
        collateralRatio: 0,
      }),
    ]);
  });
});
