import { QueryClient } from '@tanstack/react-query';

describe('Phase 0 Reproduction - Frontend Layer Cache Corruption Demonstration', () => {
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

  it('demonstrates double-counted balances when duplicate SSE events are processed without ${tx_hash}:${event_index} dedup', () => {
    const loanId = 10;
    const queryKey = ['loans', 'detail', String(loanId)];

    // Initial state: Loan approved, principal = 1000, repayments = 0, status = 'Approved'
    queryClient.setQueryData(queryKey, {
      loanId,
      status: 'Approved',
      outstandingBalance: 1000,
      repayments: 0,
    });

    // 1. Optimistic default application (onMutate)
    const optimisticState = {
      ...queryClient.getQueryData<any>(queryKey),
      status: 'Defaulted',
      outstandingBalance: 0,
    };
    queryClient.setQueryData(queryKey, optimisticState);

    // 2. Incoming SSE event 1: LoanRepaid or LoanDefaulted balance adjustment
    // Without dedup on `${tx_hash}:${event_index}`, duplicate events reduce or adjust balance twice!
    const sseEvent1 = {
      txHash: '0xabc123',
      eventIndex: 0,
      loanId,
      eventType: 'LoanRepaid',
      amount: 500,
    };

    // Handler applying mutation directly without dedup key checking:
    const handleEventWithoutDedup = (event: typeof sseEvent1) => {
      const current = queryClient.getQueryData<any>(queryKey);
      queryClient.setQueryData(queryKey, {
        ...current,
        repayments: (current.repayments || 0) + event.amount,
        outstandingBalance: Math.max(0, (current.outstandingBalance || 0) - event.amount),
      });
    };

    handleEventWithoutDedup(sseEvent1);

    // Initial deduction applied
    expect(queryClient.getQueryData<any>(queryKey).repayments).toBe(500);

    // 3. Re-executed or duplicate SSE event with same txHash & eventIndex arrives
    const sseEvent2Duplicate = {
      txHash: '0xabc123',
      eventIndex: 0,
      loanId,
      eventType: 'LoanRepaid',
      amount: 500,
    };

    handleEventWithoutDedup(sseEvent2Duplicate);

    // Repayments double-counted to 1000!
    const corruptedData = queryClient.getQueryData<any>(queryKey);
    expect(corruptedData.repayments).toBe(1000); // Documents the defect: duplicate event was double-counted!
  });

  it('demonstrates un-settled optimistic state when batch item is skipped or missing receipt', () => {
    const loan11Key = ['loans', 'detail', '11'];

    // Optimistic default applied on loan 11
    queryClient.setQueryData(loan11Key, {
      loanId: 11,
      status: 'Defaulted', // optimistic
      isOptimistic: true,
    });

    // Loan 11 traps on-chain and is skipped, so no receipt item confirms it.
    // Lacking per-item batch_receipt reconciliation and authoritative fallback,
    // loan 11 remains permanently stuck in the optimistic state!
    const cached = queryClient.getQueryData<any>(loan11Key);
    expect(cached.isOptimistic).toBe(true);
    expect(cached.status).toBe('Defaulted'); // Corrupted optimistic view survives without reconciliation
  });
});
