"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { INDEX_SCALE, LEDGER_INTERVAL_SECONDS, mulDiv, projectOwed } from "../../lib/accrual";

export interface IndexSnapshot {
  ledgerSeq: number;
  indexValue: bigint;
}

export interface UseOwedProjectionOptions {
  loanId: string | number;
  principal: bigint;
  originIndex: bigint;
  ratePerLedgerScaled: bigint;
  initialSnapshot?: IndexSnapshot;
  currentLedger?: number;
  /**
   * Maximum ledgers ahead to project before capping to prevent runaway divergence.
   * Default is 1 ledger in accordance with the 1-ledger bounded drift invariant.
   */
  maxProjectionLedgers?: number;
}

export interface OwedProjectionResult {
  /** Authoritative settled owed from the latest indexed backend snapshot */
  settledOwed: bigint;
  /** Projected owed extrapolated forward to the current ledger */
  projectedOwed: bigint;
  /** The delta between projected owed and settled owed, marked as unsettled */
  unsettledInterest: bigint;
  /** Whether there is an active unsettled projection component */
  isUnsettled: boolean;
  /**
   * The amount to be used for repayment.
   * Invariant: repayment ALWAYS uses backend-settled owed, never the projection.
   */
  repaymentOwed: bigint;
  /** Number of ledgers projected */
  unsettledLedgers: number;
  /** Function to update snapshot directly when received from SSE */
  applySseSnapshot: (snapshot: IndexSnapshot) => void;
}

/**
 * TanStack Query hook that projects owed forward from the last indexed snapshot
 * to the current ledger using NEXT_PUBLIC_LEDGER_INTERVAL_SECONDS and the loan rate.
 *
 * Invariant 1: projected_owed - backend_owed never exceeds one ledger of interest.
 * Invariant 2: repayment always uses the backend-settled owed, never the projection.
 * Invariant 3: SSE arrival replaces the projection with the authoritative backend value.
 */
export function useOwedProjection({
  loanId,
  principal,
  originIndex,
  ratePerLedgerScaled,
  initialSnapshot,
  currentLedger,
  maxProjectionLedgers = 1,
}: UseOwedProjectionOptions): OwedProjectionResult {
  const defaultSnapshot: IndexSnapshot = useMemo(
    () =>
      initialSnapshot ?? {
        ledgerSeq: currentLedger ?? 0,
        indexValue: originIndex > BigInt(0) ? originIndex : INDEX_SCALE,
      },
    [initialSnapshot, currentLedger, originIndex],
  );

  const [authoritativeSnapshot, setAuthoritativeSnapshot] =
    useState<IndexSnapshot>(defaultSnapshot);

  // Sync state if initialSnapshot changes externally
  useEffect(() => {
    if (initialSnapshot) {
      setAuthoritativeSnapshot(initialSnapshot);
    }
  }, [initialSnapshot]);

  // Hook query cache for the loan's settled snapshot
  const { data: cachedSnapshot } = useQuery<IndexSnapshot>({
    queryKey: ["loan", String(loanId), "interest-index"],
    queryFn: () => authoritativeSnapshot,
    initialData: authoritativeSnapshot,
    staleTime: 5_000,
  });

  const activeSnapshot = cachedSnapshot ?? authoritativeSnapshot;

  // Calculate unsettled ledgers, bounded by maxProjectionLedgers (default 1 ledger)
  const rawElapsedLedgers =
    currentLedger !== undefined && currentLedger > activeSnapshot.ledgerSeq
      ? currentLedger - activeSnapshot.ledgerSeq
      : 0;

  const unsettledLedgers = Math.min(rawElapsedLedgers, maxProjectionLedgers);

  const projection = useMemo(() => {
    if (principal <= BigInt(0) || originIndex <= BigInt(0)) {
      return {
        settledOwed: BigInt(0),
        projectedOwed: BigInt(0),
        unsettledInterest: BigInt(0),
        isUnsettled: false,
      };
    }

    const { projectedOwed, unsettledInterest } = projectOwed(
      principal,
      originIndex,
      activeSnapshot.indexValue,
      unsettledLedgers,
      ratePerLedgerScaled,
    );

    const settledOwed = mulDiv(principal, activeSnapshot.indexValue, originIndex);

    return {
      settledOwed,
      projectedOwed,
      unsettledInterest,
      isUnsettled: unsettledLedgers > 0 && unsettledInterest > BigInt(0),
    };
  }, [principal, originIndex, activeSnapshot.indexValue, unsettledLedgers, ratePerLedgerScaled]);

  const applySseSnapshot = useCallback((newSnapshot: IndexSnapshot) => {
    setAuthoritativeSnapshot(newSnapshot);
  }, []);

  return {
    settledOwed: projection.settledOwed,
    projectedOwed: projection.projectedOwed,
    unsettledInterest: projection.unsettledInterest,
    isUnsettled: projection.isUnsettled,
    // Repayment always uses the backend-settled owed, never the projection
    repaymentOwed: projection.settledOwed,
    unsettledLedgers,
    applySseSnapshot,
  };
}
