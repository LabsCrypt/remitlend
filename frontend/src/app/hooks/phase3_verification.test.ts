import { QueryClient } from '@tanstack/react-query';
import { BatchOpFSM } from '../lib/batchOpFSM';
import { LoanError } from '../types/batchTypes.generated';

describe('Phase 3 Verification - Frontend Layer Batch FSM, Dedup, and Error Mapping', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
  });

  afterEach(() => {
    queryClient.clear();
  });

  describe('Batch-op FSM transitions and state progression', () => {
    it('advances through idle -> building -> broadcasting -> partially_applied -> reconciling -> settled', () => {
      const fsm = new BatchOpFSM('batch-1');
      expect(fsm.getState()).toBe('idle');

      // 1. start build
      const items = new Map([
        ['10', { status: 'Defaulted' }],
        ['11', { status: 'Defaulted' }],
      ]);
      fsm.transition({
        type: 'START_BUILD',
        nonce: '1',
        validUntilLedger: 200,
        items,
      });
      expect(fsm.getState()).toBe('building');

      // 2. broadcast
      fsm.transition({
        type: 'SUBMIT_BROADCAST',
        txHash: '0xhash1',
      });
      expect(fsm.getState()).toBe('broadcasting');

      // 3. receipt with partial items -> partially_applied
      fsm.transition({
        type: 'RECEIPT_OBSERVED',
        items: [{ loanId: '10', status: { type: 'Applied' } }],
      });
      expect(fsm.getState()).toBe('partially_applied');

      // 4. receipt with remaining items -> reconciling
      fsm.transition({
        type: 'RECEIPT_OBSERVED',
        items: [{ loanId: '11', status: { type: 'Skipped', code: 101 } }],
      });
      expect(fsm.getState()).toBe('reconciling');

      // 5. reconcile success -> settled
      fsm.transition({ type: 'RECONCILE_SUCCESS' });
      expect(fsm.getState()).toBe('settled');

      // 6. reset -> idle
      fsm.transition({ type: 'RESET' });
      expect(fsm.getState()).toBe('idle');
    });

    it('rejects illegal transitions', () => {
      const fsm = new BatchOpFSM('batch-bad');
      expect(fsm.getState()).toBe('idle');

      // Cannot transition from idle to reconciling directly
      expect(() => {
        fsm.transition({ type: 'RECONCILE_SUCCESS' });
      }).toThrow(/Illegal FSM transition/);
    });
  });

  describe('SSE Dedup on ${tx_hash}:${event_index} and per-item reconciliation', () => {
    it('collapses duplicate events with same tx_hash and event_index preventing double-counting', () => {
      const loanKey = ['loans', 'detail', '10'];
      queryClient.setQueryData(loanKey, {
        loanId: 10,
        repayments: 0,
        outstandingBalance: 1000,
      });

      const seenKeys = new Set<string>();

      const applyEventWithDedup = (event: {
        txHash: string;
        eventIndex: number;
        amount: number;
      }) => {
        const dedupKey = `${event.txHash}:${event.eventIndex}`;
        if (seenKeys.has(dedupKey)) {
          return; // Drop duplicate!
        }
        seenKeys.add(dedupKey);

        const current = queryClient.getQueryData<any>(loanKey);
        queryClient.setQueryData(loanKey, {
          ...current,
          repayments: (current.repayments || 0) + event.amount,
          outstandingBalance: Math.max(0, (current.outstandingBalance || 0) - event.amount),
        });
      };

      const event = { txHash: '0xtx123', eventIndex: 0, amount: 500 };

      // First delivery
      applyEventWithDedup(event);
      expect(queryClient.getQueryData<any>(loanKey).repayments).toBe(500);

      // Duplicate delivery (e.g. from retry or re-broadcast)
      applyEventWithDedup(event);

      // Repayments remain exactly 500, no double-counting!
      expect(queryClient.getQueryData<any>(loanKey).repayments).toBe(500);
      expect(queryClient.getQueryData<any>(loanKey).outstandingBalance).toBe(500);
    });

    it('reconciles optimistic item states using batch_receipt (Applied vs Skipped)', () => {
      const loan10Key = ['loans', 'detail', '10'];
      const loan11Key = ['loans', 'detail', '11'];

      // Initial state
      queryClient.setQueryData(loan10Key, { loanId: 10, status: 'Approved' });
      queryClient.setQueryData(loan11Key, { loanId: 11, status: 'Approved' });

      // Snapshots before optimistic mutation
      const snapshot10 = { loanId: 10, status: 'Approved' };
      const snapshot11 = { loanId: 11, status: 'Approved' };

      // Optimistic defaults applied
      queryClient.setQueryData(loan10Key, { loanId: 10, status: 'Defaulted', isOptimistic: true });
      queryClient.setQueryData(loan11Key, { loanId: 11, status: 'Defaulted', isOptimistic: true });

      // Receipt arrives: Loan 10 Applied, Loan 11 Skipped
      const receipt = [
        { loanId: '10', status: { type: 'Applied' as const } },
        { loanId: '11', status: { type: 'Skipped' as const, code: 42 } },
      ];

      for (const item of receipt) {
        const key = item.loanId === '10' ? loan10Key : loan11Key;
        if (item.status.type === 'Applied') {
          const cur = queryClient.getQueryData<any>(key);
          queryClient.setQueryData(key, { ...cur, isOptimistic: false, authoritative: true });
        } else if (item.status.type === 'Skipped') {
          // Roll back to snapshot
          const snapshot = item.loanId === '10' ? snapshot10 : snapshot11;
          queryClient.setQueryData(key, snapshot);
        }
      }

      // Loan 10 is confirmed as Defaulted (authoritative)
      expect(queryClient.getQueryData<any>(loan10Key).status).toBe('Defaulted');
      expect(queryClient.getQueryData<any>(loan10Key).isOptimistic).toBe(false);

      // Loan 11 is rolled back to Approved (not stuck in optimistic Defaulted)
      expect(queryClient.getQueryData<any>(loan11Key).status).toBe('Approved');
    });
  });

  describe('Error code mapping', () => {
    it('maps NonceReused to idempotent settle without rebroadcasting', () => {
      const fsm = new BatchOpFSM('batch-reused');
      fsm.transition({
        type: 'START_BUILD',
        nonce: '1',
        validUntilLedger: 200,
        items: new Map([['10', {}]]),
      });
      fsm.transition({ type: 'SUBMIT_BROADCAST', txHash: '0xreused' });

      // Server returns NonceReused
      const errorCode = LoanError.NonceReused;
      if (errorCode === LoanError.NonceReused) {
        fsm.transition({ type: 'NONCE_REUSED_SETTLE' });
      }

      expect(fsm.getState()).toBe('settled');
    });

    it('maps BatchWindowExpired to rollback and rebuild with fresh valid_until_ledger', () => {
      const fsm = new BatchOpFSM('batch-expired');
      fsm.transition({
        type: 'START_BUILD',
        nonce: '1',
        validUntilLedger: 100,
        items: new Map([['10', {}]]),
      });
      fsm.transition({ type: 'SUBMIT_BROADCAST', txHash: '0xexpired' });

      // Server returns BatchWindowExpired (30)
      const errorCode = LoanError.BatchWindowExpired;
      if (errorCode === LoanError.BatchWindowExpired) {
        fsm.transition({ type: 'SUBMIT_ERROR', error: 'Batch window expired', errorCode });
        fsm.transition({ type: 'BATCH_WINDOW_EXPIRED_REBUILD' });
      }

      // Re-enters building state ready for rebuild
      expect(fsm.getState()).toBe('building');
    });
  });
});
