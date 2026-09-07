import React from "react";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useOwedProjection } from "./useOwedProjection";
import { mulDiv, INDEX_SCALE } from "../../lib/accrual";
import vectors from "../../../../contracts/testdata/accrual_vectors.json";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("frontend accrual parity and useOwedProjection", () => {
  it("matches all golden vectors from contracts/testdata/accrual_vectors.json", () => {
    for (const v of vectors) {
      const principal = BigInt(v.principal);
      const expectedIndex = BigInt(v.expected_index);
      const expectedOwed = BigInt(v.expected_owed);

      const computedOwed = mulDiv(principal, expectedIndex, INDEX_SCALE);
      expect(computedOwed.toString()).toBe(expectedOwed.toString());
    }
  });

  it("projects owed forward by at most 1 ledger and marks it as unsettled", () => {
    const principal = BigInt("10000000000"); // 1000 XLM
    const originIndex = INDEX_SCALE;
    const ratePerLedgerScaled = BigInt("7922816251"); // ~5% APR

    const { result } = renderHook(
      () =>
        useOwedProjection({
          loanId: "1",
          principal,
          originIndex,
          ratePerLedgerScaled,
          initialSnapshot: {
            ledgerSeq: 100,
            indexValue: originIndex,
          },
          currentLedger: 101, // 1 ledger ahead
          maxProjectionLedgers: 1,
        }),
      { wrapper: createWrapper() },
    );

    const settledOwed = result.current.settledOwed;
    const projectedOwed = result.current.projectedOwed;
    const unsettledInterest = result.current.unsettledInterest;

    // Projected owed should be strictly greater than settled owed
    expect(projectedOwed).toBeGreaterThan(settledOwed);
    expect(unsettledInterest).toBe(projectedOwed - settledOwed);
    expect(result.current.isUnsettled).toBe(true);

    // Invariant: repayment ALWAYS uses settled owed, never the projection
    expect(result.current.repaymentOwed).toBe(settledOwed);

    // Invariant: projected_owed - backend_owed never exceeds 1 ledger of interest
    const oneLedgerInterest = mulDiv(settledOwed, ratePerLedgerScaled, INDEX_SCALE);
    expect(unsettledInterest).toBeLessThanOrEqual(oneLedgerInterest + BigInt(1));
  });

  it("caps projection at maxProjectionLedgers (1 ledger) even if currentLedger is far ahead", () => {
    const principal = BigInt("10000000000");
    const originIndex = INDEX_SCALE;
    const ratePerLedgerScaled = BigInt("7922816251");

    const { result } = renderHook(
      () =>
        useOwedProjection({
          loanId: "2",
          principal,
          originIndex,
          ratePerLedgerScaled,
          initialSnapshot: {
            ledgerSeq: 100,
            indexValue: originIndex,
          },
          currentLedger: 200, // 100 ledgers ahead
          maxProjectionLedgers: 1, // capped at 1
        }),
      { wrapper: createWrapper() },
    );

    expect(result.current.unsettledLedgers).toBe(1);
    const settledOwed = result.current.settledOwed;
    const oneLedgerInterest = mulDiv(settledOwed, ratePerLedgerScaled, INDEX_SCALE);
    expect(result.current.unsettledInterest).toBeLessThanOrEqual(oneLedgerInterest + BigInt(1));
  });

  it("yields to authoritative backend value on SSE arrival", () => {
    const principal = BigInt("10000000000");
    const originIndex = INDEX_SCALE;
    const ratePerLedgerScaled = BigInt("7922816251");

    const { result } = renderHook(
      () =>
        useOwedProjection({
          loanId: "3",
          principal,
          originIndex,
          ratePerLedgerScaled,
          initialSnapshot: {
            ledgerSeq: 100,
            indexValue: originIndex,
          },
          currentLedger: 101,
        }),
      { wrapper: createWrapper() },
    );

    expect(result.current.isUnsettled).toBe(true);

    // Simulate SSE snapshot arrival for ledger 101
    const newIndex = mulDiv(originIndex, INDEX_SCALE + ratePerLedgerScaled, INDEX_SCALE);
    act(() => {
      result.current.applySseSnapshot({
        ledgerSeq: 101,
        indexValue: newIndex,
      });
    });

    // Now currentLedger matches activeSnapshot.ledgerSeq, so projection yields to settled value
    expect(result.current.isUnsettled).toBe(false);
    expect(result.current.unsettledInterest).toBe(BigInt(0));
    expect(result.current.projectedOwed).toBe(result.current.settledOwed);
    expect(result.current.settledOwed).toBe(mulDiv(principal, newIndex, originIndex));
  });
});
