/**
 * Tests for EventIndexer transaction atomicity.
 *
 * These tests verify that:
 *  1. Event insert + score update commit atomically (happy path)
 *  2. A score-update failure causes the entire operation to throw (rollback)
 *  3. An event-insert failure causes the operation to throw before score updates run
 *  4. Duplicate events (ON CONFLICT DO NOTHING) do not trigger score updates
 */

import { jest, describe, it, expect, beforeAll, beforeEach, afterEach } from '@jest/globals';

// --------------------------------------------------------------------------
// Mock declarations
// --------------------------------------------------------------------------

let mockWithTransaction: jest.Mock;
let mockUpdateUserScoresBulk: jest.Mock;
let mockSorobanGetScoreConfig: jest.Mock;
let mockWebhookDispatch: jest.Mock;
let mockEventStreamBroadcast: jest.Mock;
let mockNotificationCreate: jest.Mock;

type TxCallback = (client: MockClient) => Promise<unknown>;

interface MockClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: jest.Mock<any>;
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/** Build a raw Soroban event that parses as LoanRepaid with borrower="addr" */
function makeRawRepaidEvent(id = 'event-001'): Record<string, unknown> {
  const makeSym = (name: string) => ({
    sym: () => ({ toString: () => name }),
    toXDR: (_enc: string) => `xdr:${name}`,
  });

  return {
    id,
    pagingToken: id,
    topic: [
      makeSym('LoanRepaid'),
      { sym: () => ({ toString: () => 'addr' }), toXDR: () => 'xdr:addr' },
      { sym: () => ({ toString: () => '1' }), toXDR: () => 'xdr:1' },
    ],
    value: {
      _val: 1000n,
      sym: () => {
        throw new Error('not a sym');
      },
      toXDR: () => 'xdr:val',
    },
    ledger: 100,
    ledgerClosedAt: new Date().toISOString(),
    txHash: 'txhash001',
    contractId: { toString: () => 'CONTRACT001' },
  };
}

function makeRawAdminConfigEvent(id = 'admin-evt-001'): Record<string, unknown> {
  const makeSym = (name: string) => ({
    sym: () => ({ toString: () => name }),
    toXDR: (_enc: string) => `xdr:${name}`,
  });

  return {
    id,
    pagingToken: id,
    topic: [
      makeSym('LateFeeRateUpdated'),
      {
        sym: () => ({ toString: () => 'admin-addr' }),
        toXDR: () => 'xdr:admin',
      },
    ],
    value: {
      _val: [10n, 25n],
      sym: () => {
        throw new Error('not a sym');
      },
      toXDR: () => 'xdr:admin-val',
    },
    ledger: 101,
    ledgerClosedAt: new Date().toISOString(),
    txHash: 'txhash-admin-001',
    contractId: { toString: () => 'CONTRACT001' },
  };
}

/**
 * Build a raw Soroban event that parses as LoanApprv.
 * topic[0] = "LoanApprv" (event type symbol)
 * topic[1] = admin address ("GADMIN123")
 * value    = [loanId=42, borrower="GBORROWER123"]
 */
function makeRawLoanApprvEvent(id = 'apprv-001'): Record<string, unknown> {
  const makeSym = (name: string) => ({
    sym: () => ({ toString: () => name }),
    toXDR: (_enc: string) => `xdr:${name}`,
  });

  return {
    id,
    pagingToken: id,
    topic: [
      makeSym('LoanApprv'),
      // admin address — _val makes scValToNative return a string
      {
        _val: 'GADMIN123',
        sym: () => {
          throw new Error('not a sym');
        },
        toXDR: () => 'xdr:admin',
      },
    ],
    value: {
      // scValToNative returns [42, "GBORROWER123"] for arrays
      _val: [42, 'GBORROWER123'],
      sym: () => {
        throw new Error('not a sym');
      },
      toXDR: () => 'xdr:apprv-val',
    },
    ledger: 200,
    ledgerClosedAt: new Date().toISOString(),
    txHash: 'txhash-apprv-001',
    contractId: { toString: () => 'CONTRACT001' },
  };
}

/**
 * Build a raw Soroban event that parses as LoanLiquidated.
 * topic[0] = "LoanLiquidated", topic[1] = loan_id=7, topic[2] = borrower="GBORROWER456", topic[3] = liquidator
 * value    = [debt_repaid=5000, liquidator_bonus=500, borrower_refund=200]
 */
function makeRawLoanLiquidatedEvent(id = 'liq-001'): Record<string, unknown> {
  const makeSym = (name: string) => ({
    sym: () => ({ toString: () => name }),
    toXDR: (_enc: string) => `xdr:${name}`,
  });

  return {
    id,
    pagingToken: id,
    topic: [
      makeSym('LoanLiquidated'),
      {
        _val: 7,
        sym: () => {
          throw new Error('not a sym');
        },
        toXDR: () => 'xdr:loanid',
      },
      {
        _val: 'GBORROWER456',
        sym: () => {
          throw new Error('not a sym');
        },
        toXDR: () => 'xdr:borrower',
      },
      {
        _val: 'GLIQUIDATOR789',
        sym: () => {
          throw new Error('not a sym');
        },
        toXDR: () => 'xdr:liquidator',
      },
    ],
    value: {
      _val: [5000n, 500n, 200n],
      sym: () => {
        throw new Error('not a sym');
      },
      toXDR: () => 'xdr:liq-val',
    },
    ledger: 300,
    ledgerClosedAt: new Date().toISOString(),
    txHash: 'txhash-liq-001',
    contractId: { toString: () => 'CONTRACT001' },
  };
}

/** Run the withTransaction callback immediately using the provided mock client. */
function stubWithTransaction(mockClient: MockClient): void {
  (mockWithTransaction as jest.Mock<any>).mockImplementation(async (fn: TxCallback) =>
    fn(mockClient),
  );
}

// --------------------------------------------------------------------------
// Module setup
// --------------------------------------------------------------------------

let EventIndexer: new (options: { rpcUrl: string; contractIds: string[] }) => {
  ingestRawEvents: (events: Record<string, unknown>[]) => Promise<{ insertedCount: number }>;
};

beforeAll(async () => {
  mockWithTransaction = jest.fn();
  mockUpdateUserScoresBulk = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
  mockSorobanGetScoreConfig = jest
    .fn<() => { repaymentDelta: number; defaultPenalty: number }>()
    .mockReturnValue({ repaymentDelta: 10, defaultPenalty: 20 });
  mockWebhookDispatch = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
  mockEventStreamBroadcast = jest.fn();
  mockNotificationCreate = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

  jest.unstable_mockModule('../../db/connection.js', () => ({
    query: jest
      .fn<(...args: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>>()
      .mockResolvedValue({ rows: [], rowCount: 0 } as never),
    getClient: jest.fn(),
    withTransaction: mockWithTransaction,
    TRANSIENT_ERROR_CODES: new Set(['08006', '57P01', '40001']),
  }));

  jest.unstable_mockModule('../scoresService.js', () => ({
    updateUserScoresBulk: mockUpdateUserScoresBulk,
  }));

  jest.unstable_mockModule('../sorobanService.js', () => ({
    sorobanService: { getScoreConfig: mockSorobanGetScoreConfig },
  }));

  jest.unstable_mockModule('../webhookService.js', () => ({
    webhookService: { dispatch: mockWebhookDispatch },
    IndexedLoanEvent: {},
    WebhookEventType: {},
    SUPPORTED_WEBHOOK_EVENT_TYPES: [
      'LoanRequested',
      'LoanApproved',
      'LoanRepaid',
      'LoanDefaulted',
      'CollateralLiquidated',
      'LoanLiquidated',
      'Deposit',
      'Withdraw',
      'YieldDistributed',
      'EmergencyWithdraw',
      'NFTMinted',
      'ScoreUpdated',
      'NFTSeized',
      'NFTBurned',
      'ProposalCreated',
      'ProposalApproved',
      'ProposalFinalized',
      'Mint',
      'ScoreUpd',
      'Seized',
      'GovProp',
      'GovAppr',
      'GovFin',
      'Transfer',
      'MntAuth',
      'MntRev',
      'Paused',
      'Unpaused',
      'MinScoreUpdated',
      'InterestRateUpdated',
      'DefaultTermUpdated',
      'TermLimitsUpdated',
      'LateFeeRateUpdated',
      'GracePeriodUpdated',
      'DefaultWindowUpdated',
      'MaxLoanAmountUpdated',
      'MinRepaymentUpdated',
      'MaxLoansPerBorrower',
      'MinRateBpsUpdated',
      'MaxRateBpsUpdated',
      'RateOracleUpdated',
      'PoolPaused',
      'PoolUnpaused',
      'LoanApprv',
    ],
  }));

  jest.unstable_mockModule('../eventStreamService.js', () => ({
    eventStreamService: { broadcast: mockEventStreamBroadcast },
  }));

  jest.unstable_mockModule('../notificationService.js', () => ({
    notificationService: { createNotification: mockNotificationCreate },
  }));

  jest.unstable_mockModule('../../utils/logger.js', () => ({
    default: {
      warn: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
    },
  }));

  jest.unstable_mockModule('../../utils/requestContext.js', () => ({
    createRequestId: jest.fn().mockReturnValue('test-req-id'),
    runWithRequestContext: jest.fn((_id: string, fn: () => Promise<unknown>) => fn()),
  }));

  jest.unstable_mockModule('@stellar/stellar-sdk', () => ({
    rpc: {
      Server: jest.fn<(...args: unknown[]) => unknown>().mockImplementation(() => ({
        getEvents: jest
          .fn<() => Promise<{ events: unknown[] }>>()
          .mockResolvedValue({ events: [] } as never),
        getLatestLedger: jest
          .fn<() => Promise<{ sequence: number }>>()
          .mockResolvedValue({ sequence: 0 } as never),
      })),
    },
    scValToNative: jest.fn((val: Record<string, unknown>) => {
      const v = val as Record<string, unknown>;
      if (v._val !== undefined) return v._val;
      return (v.sym as unknown as () => { toString: () => string })?.()?.toString?.() ?? '';
    }),
    xdr: { ScVal: {} as never },
  }));

  jest.unstable_mockModule('../../errors/AppError.js', () => ({
    AppError: { badRequest: (msg: string) => new Error(msg) },
  }));

  const mod = await import('../eventIndexer.js');
  EventIndexer = (mod as unknown as { EventIndexer: typeof EventIndexer }).EventIndexer;
});

beforeEach(() => {
  jest.clearAllMocks();
  // Restore default score config after each test
  mockSorobanGetScoreConfig.mockReturnValue({
    repaymentDelta: 10,
    defaultPenalty: 20,
  });
  (mockUpdateUserScoresBulk as jest.Mock<any>).mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function makeIndexer() {
  return new EventIndexer({
    rpcUrl: 'http://localhost:8000',
    contractIds: ['CONTRACT001'],
  });
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe('EventIndexer – transaction atomicity via ingestRawEvents', () => {
  it('happy path: event insert succeeds and score update is called with the pinned client', async () => {
    const mockClient: MockClient = {
      query: jest.fn().mockResolvedValue({
        rowCount: 1,
        rows: [{ event_id: 'event-001' }],
      } as never),
    };
    stubWithTransaction(mockClient);

    const result = await (makeIndexer().ingestRawEvents([
      makeRawRepaidEvent('event-001'),
    ]) as Promise<{ insertedCount: number }>);

    // withTransaction must have been called once
    expect(mockWithTransaction).toHaveBeenCalledTimes(1);

    // insertedCount reflects the new row
    expect(result.insertedCount).toBe(1);

    // Score update called exactly once, with the pinned client
    expect(mockUpdateUserScoresBulk).toHaveBeenCalledTimes(1);
    const [updates, passedClient] = mockUpdateUserScoresBulk.mock.calls[0] as [
      Map<string, number>,
      MockClient,
    ];
    expect(passedClient).toBe(mockClient);
    // LoanRepaid for borrower "addr" with repaymentDelta 10
    expect([...updates.entries()]).toEqual([['addr', 10]]);
  });

  it('score update failure propagates — the whole operation throws', async () => {
    const mockClient: MockClient = {
      query: jest.fn().mockResolvedValue({
        rowCount: 1,
        rows: [{ event_id: 'event-rollback' }],
      } as never),
    };
    // withTransaction executes the callback but re-throws when it throws
    (mockWithTransaction as jest.Mock<any>).mockImplementation(async (fn: TxCallback) => {
      try {
        return await fn(mockClient);
      } catch (err) {
        throw err; // simulate rollback + re-throw
      }
    });
    (mockUpdateUserScoresBulk as jest.Mock<any>).mockRejectedValueOnce(new Error('score db fail'));

    await expect(
      makeIndexer().ingestRawEvents([makeRawRepaidEvent('event-rollback')]) as Promise<unknown>,
    ).rejects.toThrow('score db fail');

    expect(mockWithTransaction).toHaveBeenCalledTimes(1);
  });

  it('event INSERT failure propagates before score update runs', async () => {
    const insertError = Object.assign(new Error('insert constraint violated'), {
      code: '23505',
    });
    const mockClient: MockClient = {
      query: jest.fn().mockRejectedValueOnce(insertError as never),
    };
    (mockWithTransaction as jest.Mock<any>).mockImplementation(async (fn: TxCallback) => {
      try {
        return await fn(mockClient);
      } catch (err) {
        throw err;
      }
    });

    await expect(
      makeIndexer().ingestRawEvents([makeRawRepaidEvent('event-insert-fail')]) as Promise<unknown>,
    ).rejects.toThrow('insert constraint violated');

    // Score update must not have been reached
    expect(mockUpdateUserScoresBulk).not.toHaveBeenCalled();
  });

  it('duplicate event (ON CONFLICT DO NOTHING) → rowCount=0 → no score update', async () => {
    const mockClient: MockClient = {
      query: jest.fn().mockResolvedValue({ rowCount: 0, rows: [] } as never),
    };
    stubWithTransaction(mockClient);

    const result = await (makeIndexer().ingestRawEvents([
      makeRawRepaidEvent('dup-event'),
    ]) as Promise<{ insertedCount: number }>);

    expect(result.insertedCount).toBe(0);
    expect(mockUpdateUserScoresBulk).not.toHaveBeenCalled();
  });

  it('aggregates score deltas for multiple events in a single bulk call', async () => {
    // Two LoanRepaid events for the same borrower should sum their deltas
    const event1 = makeRawRepaidEvent('evt-a');
    const event2 = makeRawRepaidEvent('evt-b');

    let callCount = 0;
    const mockClient: MockClient = {
      query: jest.fn().mockImplementation(async () => {
        callCount++;
        return { rowCount: 1, rows: [{ event_id: `evt-${callCount}` }] };
      }) as jest.Mock,
    };
    stubWithTransaction(mockClient);

    await (makeIndexer().ingestRawEvents([event1, event2]) as Promise<unknown>);

    // Should be called once (bulk) not twice
    expect(mockUpdateUserScoresBulk).toHaveBeenCalledTimes(1);
    const [updates] = mockUpdateUserScoresBulk.mock.calls[0] as [Map<string, number>];
    // repaymentDelta: 10, two events → 20
    expect(updates.get('addr')).toBe(20);
  });

  it("withTransaction is called — not the legacy query('BEGIN') approach", async () => {
    const mockQuery = (await import('../../db/connection.js')).query as jest.Mock;

    const mockClient: MockClient = {
      query: jest.fn().mockResolvedValue({ rowCount: 0, rows: [] } as never),
    };
    stubWithTransaction(mockClient);

    await (makeIndexer().ingestRawEvents([makeRawRepaidEvent()]) as Promise<unknown>);

    // The pool-level query() should NOT have been called with 'BEGIN'
    const beginCalls = mockQuery.mock.calls.filter(([sql]) => sql === 'BEGIN');
    expect(beginCalls).toHaveLength(0);

    // withTransaction is the entry point instead
    expect(mockWithTransaction).toHaveBeenCalledTimes(1);
  });

  it('LoanApprv: inserts audit_logs row with actor=admin, action=loan_approved', async () => {
    const auditInsertCalls: unknown[][] = [];

    const mockClient: MockClient = {
      query: jest.fn<any>().mockImplementation(async (sql: string, params: unknown[]) => {
        if (sql.includes('INSERT INTO loan_events')) {
          return { rowCount: 1, rows: [{ event_id: 'apprv-001' }] };
        }
        if (sql.includes('INSERT INTO audit_logs')) {
          auditInsertCalls.push(params);
          return { rowCount: 1, rows: [] };
        }
        return { rowCount: 0, rows: [] };
      }),
    };
    stubWithTransaction(mockClient);

    const result = await (makeIndexer().ingestRawEvents([makeRawLoanApprvEvent()]) as Promise<{
      insertedCount: number;
    }>);

    // Event must be counted as inserted
    expect(result.insertedCount).toBe(1);

    // Exactly one audit_logs INSERT must have been made
    expect(auditInsertCalls).toHaveLength(1);

    const [actor, action, target, payload, ip_address, status] = auditInsertCalls[0] as [
      string,
      string,
      string,
      string,
      string | null,
      number,
    ];

    // actor = admin address from topic[1]
    expect(actor).toBe('GADMIN123');
    // action = 'loan_approved'
    expect(action).toBe('loan_approved');
    // target = 'loan:<loanId>'
    expect(target).toBe('loan:42');
    // status = 200
    expect(status).toBe(200);

    // payload JSON must contain loanId, borrower, txHash
    const parsed = JSON.parse(payload);
    expect(parsed.loanId).toBe(42);
    expect(parsed.borrower).toBe('GBORROWER123');
    expect(parsed.txHash).toBe('txhash-apprv-001');
  });

  it('persists admin config events into audit_logs', async () => {
    const mockClient: MockClient = {
      query: jest.fn<any>().mockImplementation(async (sql: string) => {
        if (sql.includes('INSERT INTO loan_events')) {
          return { rowCount: 1, rows: [{ event_id: 'admin-evt-001' }] };
        }
        if (sql.includes('INSERT INTO audit_logs')) {
          return { rowCount: 1, rows: [] };
        }
        return { rowCount: 0, rows: [] };
      }),
    };
    stubWithTransaction(mockClient);

    const result = await (makeIndexer().ingestRawEvents([makeRawAdminConfigEvent()]) as Promise<{
      insertedCount: number;
    }>);

    expect(result.insertedCount).toBe(1);
    expect(
      mockClient.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO audit_logs')),
    ).toBe(true);
  });

  it('LoanLiquidated: creates a loan_liquidated notification for the borrower with refund info', async () => {
    const mockClient: MockClient = {
      query: jest.fn().mockResolvedValue({
        rowCount: 1,
        rows: [{ event_id: 'liq-001' }],
      } as never),
    };
    stubWithTransaction(mockClient);

    await (makeIndexer().ingestRawEvents([
      makeRawLoanLiquidatedEvent('liq-001'),
    ]) as Promise<unknown>);

    expect(mockNotificationCreate).toHaveBeenCalledTimes(1);

    const call = mockNotificationCreate.mock.calls[0]![0] as {
      userId: string;
      type: string;
      title: string;
      message: string;
      loanId: number;
    };

    expect(call.userId).toBe('GBORROWER456');
    expect(call.type).toBe('loan_liquidated');
    expect(call.title).toBe('Loan Liquidated');
    expect(call.loanId).toBe(7);
    expect(call.message).toContain('Loan #7');
    expect(call.message).toContain('200');
  });
});
