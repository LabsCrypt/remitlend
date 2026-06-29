"use client";

import { useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSSE, type RealtimeStatus } from "./useSSE";
import { queryKeys } from "./useApi";
import { useUserStore } from "../stores/useUserStore";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

const LOAN_REFRESH_EVENTS = new Set([
  "LoanRepaid",
  "LoanLiquidated",
  "LoanDefaulted",
  "LateFeeCharged",
]);

interface LoanStreamEvent {
  type?: string;
  eventType?: string;
  loanId?: number;
}

export function useLoanStream(loanId: string | undefined): RealtimeStatus {
  const queryClient = useQueryClient();
  const borrowerAddress = useUserStore((s) => s.user?.walletAddress);
  const lastInvalidateAtRef = useRef(0);

  const invalidateLoanQueries = useCallback(() => {
    if (!loanId) return;
    const now = Date.now();
    if (now - lastInvalidateAtRef.current < 500) {
      return;
    }
    lastInvalidateAtRef.current = now;

    queryClient.invalidateQueries({ queryKey: queryKeys.loans.detail(loanId) });
    queryClient.invalidateQueries({
      queryKey: [...queryKeys.loans.detail(loanId), "amortization"],
    });

    if (borrowerAddress) {
      queryClient.invalidateQueries({
        queryKey: queryKeys.borrowerLoans.byAddress(borrowerAddress),
      });
      // Also invalidate paginated borrower loans so both namespaces stay in sync (#1219)
      queryClient.invalidateQueries({
        queryKey: queryKeys.loans.borrowerPagePrefix(borrowerAddress),
      });
    }
  }, [borrowerAddress, loanId, queryClient]);

  const sseUrl =
    borrowerAddress && loanId
      ? `${API_URL}/api/events/stream?borrower=${encodeURIComponent(borrowerAddress)}`
      : null;

  return useSSE<LoanStreamEvent>({
    url: sseUrl,
    onMessage: (payload) => {
      if (payload.type === "init") return;
      if (!payload.eventType || !LOAN_REFRESH_EVENTS.has(payload.eventType)) return;
      if (String(payload.loanId ?? "") !== loanId) return;
      invalidateLoanQueries();
    },
    onFallbackPoll: invalidateLoanQueries,
  });
}
