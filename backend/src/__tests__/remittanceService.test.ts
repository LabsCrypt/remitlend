import { jest } from '@jest/globals';
import { Account, Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk';

const mockWithTransaction = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockQuery = jest.fn<
  (...args: unknown[]) => Promise<{
    rows: unknown[];
    rowCount: number;
    command: string;
    oid: number;
    fields: unknown[];
  }>
>();
const mockGetAccount = jest.fn<() => Promise<Account>>();

jest.unstable_mockModule('../db/connection.js', () => ({
  query: mockQuery,
  default: { query: mockQuery, connect: jest.fn(), end: jest.fn() },
}));

jest.unstable_mockModule('../db/transaction.js', () => ({
  withTransaction: mockWithTransaction,
}));

jest.unstable_mockModule('../config/stellar.js', () => ({
  getStellarNetworkPassphrase: () => Networks.TESTNET,
  createSorobanRpcServer: () => ({
    getAccount: mockGetAccount,
  }),
}));

const { remittanceService } = await import('../services/remittanceService.js');

const USDC_ISSUER = Keypair.random().publicKey();
const SENDER = Keypair.random().publicKey();
const RECIPIENT = Keypair.random().publicKey();

function mockRemittanceInsert() {
  mockWithTransaction.mockImplementation(async (...args: unknown[]) => {
    const callback = args[0] as (client: {
      query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }>;
    }) => Promise<unknown>;
    const now = new Date();
    let xdrValue = '';
    const result = await callback({
      query: async (_sql: string, queryParams: unknown[]) => {
        xdrValue = queryParams[8] as string;
        return {
          rows: [
            {
              id: 'remit-1',
              sender_id: SENDER,
              recipient_address: RECIPIENT,
              amount: '25',
              from_currency: queryParams[4],
              to_currency: queryParams[5],
              memo: queryParams[6],
              status: 'pending',
              transaction_hash: null,
              xdr: xdrValue,
              created_at: now,
              updated_at: now,
            },
          ],
        };
      },
    });
    return result;
  });
}

describe('remittanceService.createRemittance', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.STELLAR_USDC_ISSUER;
    delete process.env.STELLAR_EURC_ISSUER;
    delete process.env.STELLAR_PHP_ISSUER;
    mockGetAccount.mockResolvedValue(new Account(SENDER, '12345'));
    mockRemittanceInsert();
  });

  it('rejects cross-currency remittances because no conversion is performed', async () => {
    // No issuer env needed: the mismatch is rejected before asset resolution.
    await expect(
      remittanceService.createRemittance({
        recipientAddress: RECIPIENT,
        amount: 25,
        fromCurrency: 'USDC',
        toCurrency: 'PHP',
        memo: 'test',
        senderAddress: SENDER,
      }),
    ).rejects.toThrow(
      'Cross-currency remittances are not supported yet: the amount is sent as-is in USDC with no conversion, so toCurrency must equal fromCurrency',
    );

    // Rejected before any DB write or account fetch.
    expect(mockWithTransaction).not.toHaveBeenCalled();
    expect(mockGetAccount).not.toHaveBeenCalled();
  });

  it('rejects mismatched currencies that only differ after normalization', async () => {
    await expect(
      remittanceService.createRemittance({
        recipientAddress: RECIPIENT,
        amount: 25,
        fromCurrency: 'usdc',
        toCurrency: 'PHP',
        memo: 'test',
        senderAddress: SENDER,
      }),
    ).rejects.toThrow('Cross-currency remittances are not supported yet');
  });

  it('rejects unsupported source currencies', async () => {
    await expect(
      remittanceService.createRemittance({
        recipientAddress: RECIPIENT,
        amount: 25,
        fromCurrency: 'DOGE',
        toCurrency: 'DOGE',
        memo: 'test',
        senderAddress: SENDER,
      }),
    ).rejects.toThrow('Unsupported currency: DOGE');
  });

  it('rejects token currencies when issuer is not configured', async () => {
    await expect(
      remittanceService.createRemittance({
        recipientAddress: RECIPIENT,
        amount: 25,
        fromCurrency: 'USDC',
        toCurrency: 'USDC',
        memo: 'test',
        senderAddress: SENDER,
      }),
    ).rejects.toThrow('Unsupported currency: USDC');
  });

  it('builds token transfer XDR for configured USDC remittances', async () => {
    process.env.STELLAR_USDC_ISSUER = USDC_ISSUER;

    const remittance = await remittanceService.createRemittance({
      recipientAddress: RECIPIENT,
      amount: 25,
      fromCurrency: 'USDC',
      toCurrency: 'USDC',
      memo: 'test',
      senderAddress: SENDER,
    });

    const tx = TransactionBuilder.fromXDR(remittance.xdr!, Networks.TESTNET);
    const payment = tx.operations[0] as {
      asset: { getCode: () => string; getIssuer: () => string };
    };

    expect(payment.asset.getCode()).toBe('USDC');
    expect(payment.asset.getIssuer()).toBe(USDC_ISSUER);
  });

  it('moves the same amount on-chain as the amount stored in the DB', async () => {
    process.env.STELLAR_USDC_ISSUER = USDC_ISSUER;

    const remittance = await remittanceService.createRemittance({
      recipientAddress: RECIPIENT,
      amount: 25,
      fromCurrency: 'USDC',
      toCurrency: 'USDC',
      memo: 'test',
      senderAddress: SENDER,
    });

    const tx = TransactionBuilder.fromXDR(remittance.xdr!, Networks.TESTNET);
    const payment = tx.operations[0] as { amount: string };

    expect(payment.amount).toBe('25.0000000');
    expect(remittance.amount).toBe(25);
  });

  it("builds the payment XDR from the sender's live Stellar sequence", async () => {
    const remittance = await remittanceService.createRemittance({
      recipientAddress: RECIPIENT,
      amount: 25,
      fromCurrency: 'XLM',
      toCurrency: 'XLM',
      memo: 'test',
      senderAddress: SENDER,
    });

    expect(mockGetAccount).toHaveBeenCalledWith(SENDER);

    const tx = TransactionBuilder.fromXDR(
      remittance.xdr!,
      Networks.TESTNET,
    ) as import('@stellar/stellar-sdk').Transaction;
    expect(tx.source).toBe(SENDER);
    expect(tx.sequence).toBe('12346');
  });
});

describe('remittanceService.getRemittances with filters', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('filters remittances by status', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'remit-1',
          sender_id: SENDER,
          recipient_address: RECIPIENT,
          amount: '100',
          from_currency: 'USDC',
          to_currency: 'USDC',
          memo: null,
          status: 'completed',
          transaction_hash: 'tx123',
          xdr: 'xdr123',
          created_at: new Date('2024-03-01'),
          updated_at: new Date('2024-03-01'),
        },
      ],
      command: 'SELECT',
      rowCount: 1,
      oid: 0,
      fields: [],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ total: '1' }],
      command: 'SELECT',
      rowCount: 1,
      oid: 0,
      fields: [],
    });

    const result = await remittanceService.getRemittances(SENDER, 20, null, 'completed');

    expect(result.remittances).toHaveLength(1);
    expect(result.remittances[0]!.status).toBe('completed');
    expect(result.total).toBe(1);
  });

  it('filters remittances by date range', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'remit-2',
          sender_id: SENDER,
          recipient_address: RECIPIENT,
          amount: '50',
          from_currency: 'USDC',
          to_currency: 'USDC',
          memo: null,
          status: 'completed',
          transaction_hash: 'tx456',
          xdr: 'xdr456',
          created_at: new Date('2024-03-15'),
          updated_at: new Date('2024-03-15'),
        },
      ],
      command: 'SELECT',
      rowCount: 1,
      oid: 0,
      fields: [],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ total: '1' }],
      command: 'SELECT',
      rowCount: 1,
      oid: 0,
      fields: [],
    });

    const result = await remittanceService.getRemittances(
      SENDER,
      20,
      null,
      undefined,
      '2024-03-01',
      '2024-03-31',
    );

    expect(result.remittances).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it('searches remittances by recipient address', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'remit-3',
          sender_id: SENDER,
          recipient_address: RECIPIENT,
          amount: '75',
          from_currency: 'USDC',
          to_currency: 'USDC',
          memo: null,
          status: 'completed',
          transaction_hash: 'tx789',
          xdr: 'xdr789',
          created_at: new Date('2024-03-10'),
          updated_at: new Date('2024-03-10'),
        },
      ],
      command: 'SELECT',
      rowCount: 1,
      oid: 0,
      fields: [],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ total: '1' }],
      command: 'SELECT',
      rowCount: 1,
      oid: 0,
      fields: [],
    });

    const result = await remittanceService.getRemittances(
      SENDER,
      20,
      null,
      undefined,
      undefined,
      undefined,
      RECIPIENT.substring(0, 10),
    );

    expect(result.remittances).toHaveLength(1);
    expect(result.remittances[0]!.recipientAddress).toBe(RECIPIENT);
  });

  it('combines multiple filters', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'remit-4',
          sender_id: SENDER,
          recipient_address: RECIPIENT,
          amount: '200',
          from_currency: 'USDC',
          to_currency: 'USDC',
          memo: 'payment',
          status: 'completed',
          transaction_hash: 'tx999',
          xdr: 'xdr999',
          created_at: new Date('2024-03-20'),
          updated_at: new Date('2024-03-20'),
        },
      ],
      command: 'SELECT',
      rowCount: 1,
      oid: 0,
      fields: [],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ total: '1' }],
      command: 'SELECT',
      rowCount: 1,
      oid: 0,
      fields: [],
    });

    const result = await remittanceService.getRemittances(
      SENDER,
      20,
      null,
      'completed',
      '2024-03-01',
      '2024-03-31',
      'payment',
    );

    expect(result.remittances).toHaveLength(1);
    expect(result.remittances[0]!.status).toBe('completed');
  });

  it('rejects invalid date formats', async () => {
    await expect(
      remittanceService.getRemittances(SENDER, 20, null, undefined, 'invalid-date'),
    ).rejects.toThrow("Invalid 'from' date format");
  });
});

describe('remittanceService.updateRemittanceStatus status transitions (#1850)', () => {
  const row = (status: string) => {
    const now = new Date('2024-03-01T00:00:00.000Z');
    return {
      id: 'remit-1',
      sender_id: SENDER,
      recipient_address: RECIPIENT,
      amount: '25',
      from_currency: 'USDC',
      to_currency: 'USDC',
      memo: null,
      status,
      transaction_hash: null,
      error_message: null,
      xdr: 'xdr123',
      created_at: now,
      updated_at: now,
    };
  };

  const emptyResult = {
    rows: [],
    rowCount: 0,
    command: 'UPDATE',
    oid: 0,
    fields: [],
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('claims `processing` with a single UPDATE conditioned on the current status', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [row('processing')],
      rowCount: 1,
      command: 'UPDATE',
      oid: 0,
      fields: [],
    });

    const updated = await remittanceService.updateRemittanceStatus('remit-1', 'processing');

    expect(updated?.status).toBe('processing');

    const [text] = mockQuery.mock.calls[0]! as [string, unknown[]];
    expect(text.replace(/\s+/g, ' ').trim()).toBe(
      `UPDATE remittances SET status = $1, transaction_hash = $2, error_message = $3, updated_at = $4 WHERE id = $5 AND status = 'pending' RETURNING *`,
    );
  });

  it('resolves null when the guarded claim matched no row (a concurrent request won)', async () => {
    mockQuery
      .mockResolvedValueOnce(emptyResult) // guard did not match: row not pending
      .mockResolvedValueOnce({
        rows: [{ id: 'remit-1' }], // ...but the row itself still exists
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

    await expect(
      remittanceService.updateRemittanceStatus('remit-1', 'processing'),
    ).resolves.toBeNull();
  });

  it('still throws 404 when the row does not exist at all', async () => {
    mockQuery
      .mockResolvedValueOnce(emptyResult)
      .mockResolvedValueOnce({ rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] });

    await expect(remittanceService.updateRemittanceStatus('remit-1', 'processing')).rejects.toThrow(
      'Remittance not found',
    );
  });

  it('keeps terminal transitions unguarded for the request that owns the claim', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [row('completed')],
      rowCount: 1,
      command: 'UPDATE',
      oid: 0,
      fields: [],
    });

    const updated = await remittanceService.updateRemittanceStatus('remit-1', 'completed', 'tx1');

    expect(updated?.status).toBe('completed');
    const [text] = mockQuery.mock.calls[0]! as [string, unknown[]];
    expect(text).not.toContain(`status = 'pending'`);
  });
});
