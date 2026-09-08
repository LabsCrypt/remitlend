import { useState, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BatchOpFSM, type BatchItemResolution } from '../lib/batchOpFSM';
import { LoanError, type ItemStatus, type BatchOpFSMState } from '../types/batchTypes.generated';

export interface UseBatchOperationOptions {
  batchId: string;
  onSettled?: (resolved: Map<string, ItemStatus>) => void;
  onFailed?: (error: string) => void;
  rpcUrl?: string;
  forceOnchainResync?: boolean;
}

export function useBatchOperation({
  batchId,
  onSettled,
  onFailed,
  rpcUrl = typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_RPC_URL : undefined,
  forceOnchainResync = typeof process !== 'undefined' && process.env.NEXT_PUBLIC_FORCE_ONCHAIN_RESYNC === 'true',
}: UseBatchOperationOptions) {
  const queryClient = useQueryClient();
  const fsmRef = useRef<BatchOpFSM>(new BatchOpFSM(batchId));
  const [fsmState, setFsmState] = useState<BatchOpFSMState>('idle');
  const snapshotsRef = useRef<Map<string, any>>(new Map());
  const seenEventKeysRef = useRef<Set<string>>(new Set());

  const getQueryKey = (loanId: string) => ['loans', 'detail', String(loanId)];

  /**
   * Start batch build and apply optimistic provisional mutations
   */
  const startBatch = useCallback(
    (
      loanIds: string[],
      optimisticUpdates: (loanId: string, prev: any) => any,
      nonce: string,
      validUntilLedger: number,
    ) => {
      const itemsMap = new Map<string, any>();

      // Snapshot prior cache state and apply optimistic updates
      for (const loanId of loanIds) {
        const key = getQueryKey(loanId);
        const previousData = queryClient.getQueryData(key);
        snapshotsRef.current.set(loanId, previousData);

        const updated = optimisticUpdates(loanId, previousData);
        itemsMap.set(loanId, updated);

        // Mark as provisional optimistic data
        queryClient.setQueryData(key, {
          ...updated,
          isOptimistic: true,
          batchId,
        });
      }

      const nextState = fsmRef.current.transition({
        type: 'START_BUILD',
        nonce,
        validUntilLedger,
        items: itemsMap,
      });
      setFsmState(nextState);
    },
    [batchId, queryClient],
  );

  /**
   * Record transaction submission
   */
  const markBroadcasting = useCallback((txHash: string) => {
    const nextState = fsmRef.current.transition({
      type: 'SUBMIT_BROADCAST',
      txHash,
    });
    setFsmState(nextState);
  }, []);

  /**
   * Authoritative on-chain resync when NEXT_PUBLIC_FORCE_ONCHAIN_RESYNC=true or desync detected
   */
  const forceAuthoritativeResync = useCallback(
    async (loanIds: string[]) => {
      for (const loanId of loanIds) {
        const key = getQueryKey(loanId);
        // Invalidate queries so TanStack Query purges the slice and re-reads
        await queryClient.invalidateQueries({ queryKey: key });
      }
    },
    [queryClient],
  );

  /**
   * Handle incoming batch receipt with per-item status
   */
  const handleBatchReceipt = useCallback(
    async (
      txHash: string,
      eventIndex: number,
      receiptItems: BatchItemResolution[],
    ) => {
      // Dedup on ${tx_hash}:${event_index}
      const dedupKey = `${txHash}:${eventIndex}`;
      if (seenEventKeysRef.current.has(dedupKey)) {
        return; // Already folded, drop to prevent double-counting
      }
      seenEventKeysRef.current.add(dedupKey);

      // Reconcile each item against the cache
      for (const item of receiptItems) {
        const key = getQueryKey(item.loanId);

        if (item.status.type === 'Applied') {
          // Confirm mutation: clear provisional flag
          const current = queryClient.getQueryData<any>(key);
          if (current) {
            queryClient.setQueryData(key, {
              ...current,
              isOptimistic: false,
              authoritative: true,
            });
          }
        } else if (item.status.type === 'Skipped' || item.status.type === 'Reverted') {
          // Revert optimistic mutation back to snapshot
          const snapshot = snapshotsRef.current.get(item.loanId);
          if (snapshot !== undefined) {
            queryClient.setQueryData(key, snapshot);
          } else {
            queryClient.removeQueries({ queryKey: key });
          }
        }
      }

      const nextState = fsmRef.current.transition({
        type: 'RECEIPT_OBSERVED',
        items: receiptItems,
      });
      setFsmState(nextState);

      if (nextState === 'reconciling') {
        if (forceOnchainResync) {
          const loanIds = receiptItems.map((r) => r.loanId);
          await forceAuthoritativeResync(loanIds);
        }

        const settledState = fsmRef.current.transition({ type: 'RECONCILE_SUCCESS' });
        setFsmState(settledState);
        onSettled?.(fsmRef.current.getContext().resolvedItems);
      }
    },
    [forceAuthoritativeResync, forceOnchainResync, onSettled, queryClient],
  );

  /**
   * Handle errors with protocol-defined mapping
   */
  const handleError = useCallback(
    (errorCode?: number, errorMessage?: string) => {
      if (errorCode === LoanError.NonceReused) {
        // NonceReused -> idempotent settle: do not rebroadcast, mark applied/settled
        const nextState = fsmRef.current.transition({ type: 'NONCE_REUSED_SETTLE' });
        setFsmState(nextState);
        onSettled?.(fsmRef.current.getContext().resolvedItems);
        return;
      }

      if (errorCode === LoanError.BatchWindowExpired) {
        // BatchWindowExpired -> roll back snapshot, re-enter building
        for (const [loanId, snapshot] of snapshotsRef.current.entries()) {
          const key = getQueryKey(loanId);
          if (snapshot !== undefined) {
            queryClient.setQueryData(key, snapshot);
          }
        }
        const nextState = fsmRef.current.transition({
          type: 'BATCH_WINDOW_EXPIRED_REBUILD',
        });
        setFsmState(nextState);
        return;
      }

      // Unrecoverable error: roll back and mark failed
      for (const [loanId, snapshot] of snapshotsRef.current.entries()) {
        const key = getQueryKey(loanId);
        if (snapshot !== undefined) {
          queryClient.setQueryData(key, snapshot);
        }
      }

      const errStr = errorMessage || `Error ${errorCode}`;
      const nextState = fsmRef.current.transition({
        type: 'SUBMIT_ERROR',
        error: errStr,
        errorCode,
      });
      setFsmState(nextState);
      onFailed?.(errStr);
    },
    [onFailed, onSettled, queryClient],
  );

  return {
    state: fsmState,
    context: fsmRef.current.getContext(),
    startBatch,
    markBroadcasting,
    handleBatchReceipt,
    handleError,
    forceAuthoritativeResync,
  };
}
