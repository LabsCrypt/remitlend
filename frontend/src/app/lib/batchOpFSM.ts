import type { BatchOpFSMState, ItemStatus } from '../types/batchTypes.generated';

export interface BatchItemResolution {
  loanId: string;
  status: ItemStatus;
}

export interface BatchFSMContext {
  batchId: string;
  state: BatchOpFSMState;
  nonce?: string;
  validUntilLedger?: number;
  txHash?: string;
  optimisticItems: Map<string, any>;
  resolvedItems: Map<string, ItemStatus>;
  error?: string;
  errorCode?: number;
}

export type BatchFSMEvent =
  | { type: 'START_BUILD'; nonce: string; validUntilLedger: number; items: Map<string, any> }
  | { type: 'SUBMIT_BROADCAST'; txHash: string }
  | { type: 'SUBMIT_ERROR'; error: string; errorCode?: number }
  | { type: 'RECEIPT_OBSERVED'; items: BatchItemResolution[] }
  | { type: 'RECONCILE_SUCCESS' }
  | { type: 'RECONCILE_FAIL'; error: string }
  | { type: 'NONCE_REUSED_SETTLE' }
  | { type: 'BATCH_WINDOW_EXPIRED_REBUILD' }
  | { type: 'RESET' };

export class BatchOpFSM {
  private context: BatchFSMContext;

  constructor(batchId: string) {
    this.context = {
      batchId,
      state: 'idle',
      optimisticItems: new Map(),
      resolvedItems: new Map(),
    };
  }

  getState(): BatchOpFSMState {
    return this.context.state;
  }

  getContext(): Readonly<BatchFSMContext> {
    return this.context;
  }

  transition(event: BatchFSMEvent): BatchOpFSMState {
    const currentState = this.context.state;

    switch (currentState) {
      case 'idle': {
        if (event.type === 'START_BUILD') {
          this.context.nonce = event.nonce;
          this.context.validUntilLedger = event.validUntilLedger;
          this.context.optimisticItems = new Map(event.items);
          this.context.resolvedItems = new Map();
          this.context.error = undefined;
          this.context.errorCode = undefined;
          this.context.state = 'building';
          return this.context.state;
        }
        break;
      }

      case 'building': {
        if (event.type === 'SUBMIT_BROADCAST') {
          this.context.txHash = event.txHash;
          this.context.state = 'broadcasting';
          return this.context.state;
        }
        if (event.type === 'SUBMIT_ERROR') {
          this.context.error = event.error;
          this.context.errorCode = event.errorCode;
          this.context.state = 'failed';
          return this.context.state;
        }
        break;
      }

      case 'broadcasting': {
        if (event.type === 'RECEIPT_OBSERVED') {
          for (const item of event.items) {
            this.context.resolvedItems.set(item.loanId, item.status);
          }
          if (this.context.resolvedItems.size < this.context.optimisticItems.size) {
            this.context.state = 'partially_applied';
          } else {
            this.context.state = 'reconciling';
          }
          return this.context.state;
        }
        if (event.type === 'NONCE_REUSED_SETTLE') {
          this.context.state = 'settled';
          return this.context.state;
        }
        if (event.type === 'SUBMIT_ERROR') {
          this.context.error = event.error;
          this.context.errorCode = event.errorCode;
          this.context.state = 'failed';
          return this.context.state;
        }
        break;
      }

      case 'partially_applied': {
        if (event.type === 'RECEIPT_OBSERVED') {
          for (const item of event.items) {
            this.context.resolvedItems.set(item.loanId, item.status);
          }
          if (this.context.resolvedItems.size >= this.context.optimisticItems.size) {
            this.context.state = 'reconciling';
          }
          return this.context.state;
        }
        if (event.type === 'SUBMIT_ERROR') {
          this.context.error = event.error;
          this.context.errorCode = event.errorCode;
          this.context.state = 'failed';
          return this.context.state;
        }
        break;
      }

      case 'reconciling': {
        if (event.type === 'RECONCILE_SUCCESS') {
          this.context.state = 'settled';
          return this.context.state;
        }
        if (event.type === 'BATCH_WINDOW_EXPIRED_REBUILD') {
          this.context.state = 'building';
          return this.context.state;
        }
        if (event.type === 'RECONCILE_FAIL' || event.type === 'SUBMIT_ERROR') {
          this.context.error = event.error;
          this.context.state = 'failed';
          return this.context.state;
        }
        break;
      }

      case 'settled': {
        if (event.type === 'RESET') {
          this.context.state = 'idle';
          return this.context.state;
        }
        break;
      }

      case 'failed': {
        if (event.type === 'RESET') {
          this.context.state = 'idle';
          return this.context.state;
        }
        if (event.type === 'BATCH_WINDOW_EXPIRED_REBUILD') {
          this.context.state = 'building';
          return this.context.state;
        }
        break;
      }
    }

    throw new Error(
      `Illegal FSM transition from state '${currentState}' with event '${event.type}'`,
    );
  }
}
