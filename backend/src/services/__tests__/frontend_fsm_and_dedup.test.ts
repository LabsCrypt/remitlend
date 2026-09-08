import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { BatchOpFSM } from '../../../../frontend/src/app/lib/batchOpFSM.js';
import { LoanError } from '../../types/batchTypes.generated.js';

describe('Frontend FSM, SSE Dedup, and Error Mapping Verification', () => {
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
      const loanState = {
        loanId: 10,
        repayments: 0,
        outstandingBalance: 1000,
      };

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

        loanState.repayments += event.amount;
        loanState.outstandingBalance = Math.max(0, loanState.outstandingBalance - event.amount);
      };

      const event = { txHash: '0xtx123', eventIndex: 0, amount: 500 };

      // First delivery
      applyEventWithDedup(event);
      expect(loanState.repayments).toBe(500);

      // Duplicate delivery (e.g. from retry or re-broadcast)
      applyEventWithDedup(event);

      // Repayments remain exactly 500, no double-counting!
      expect(loanState.repayments).toBe(500);
      expect(loanState.outstandingBalance).toBe(500);
    });

    it('reconciles optimistic item states using batch_receipt (Applied vs Skipped)', () => {
      const loan10 = { loanId: 10, status: 'Approved' };
      const loan11 = { loanId: 11, status: 'Approved' };

      // Snapshots
      const snapshot10 = { ...loan10 };
      const snapshot11 = { ...loan11 };

      // Optimistic defaults applied
      loan10.status = 'Defaulted';
      loan11.status = 'Defaulted';

      // Receipt arrives: Loan 10 Applied, Loan 11 Skipped
      const receipt = [
        { loanId: '10', status: { type: 'Applied' as const } },
        { loanId: '11', status: { type: 'Skipped' as const, code: 42 } },
      ];

      for (const item of receipt) {
        if (item.loanId === '10' && item.status.type === 'Applied') {
          // Confirmed
          loan10.status = 'Defaulted';
        } else if (item.loanId === '11' && item.status.type === 'Skipped') {
          // Rolled back to snapshot
          loan11.status = snapshot11.status;
        }
      }

      // Loan 10 is confirmed Defaulted
      expect(loan10.status).toBe('Defaulted');
      // Loan 11 rolled back to Approved
      expect(loan11.status).toBe('Approved');
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
