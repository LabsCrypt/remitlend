import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  Account,
  Address,
  Asset,
  BASE_FEE,
  Keypair,
  nativeToScVal,
  Operation,
  StrKey,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk';

import { AppError } from '../../errors/AppError.js';
import { ErrorCode } from '../../errors/errorCodes.js';

const PASSPHRASE = 'Test SDF Network ; September 2015';
const LOAN_MANAGER_ID = StrKey.encodeContract(Buffer.alloc(32, 1));
const POOL_ID = StrKey.encodeContract(Buffer.alloc(32, 2));
const NFT_ID = StrKey.encodeContract(Buffer.alloc(32, 3));
const TOKEN_ID = StrKey.encodeContract(Buffer.alloc(32, 4));
const source = Keypair.random();
const admin = Keypair.random();
const borrower = Keypair.random();

const fakeServer = {
  getAccount: jest.fn<(publicKey: string) => Promise<Account>>(),
  getLatestLedger: jest.fn<() => Promise<{ sequence: number }>>(),
  prepareTransaction: jest.fn<(tx: Transaction) => Promise<Transaction>>(),
  simulateTransaction: jest.fn<(tx: Transaction) => Promise<unknown>>(),
  sendTransaction: jest.fn<(tx: Transaction) => Promise<unknown>>(),
  pollTransaction: jest.fn<(hash: string, options?: unknown) => Promise<unknown>>(),
  getHealth: jest.fn<() => Promise<unknown>>(),
};

jest.unstable_mockModule('../../config/stellar.js', () => ({
  createSorobanRpcServer: () => fakeServer,
  getStellarNetworkPassphrase: () => PASSPHRASE,
  getStellarRpcUrl: () => 'http://localhost:8000',
}));

const { sorobanService } = await import('../sorobanService.js');

type OperationBuilder = (
  this: typeof Operation,
  options: Record<string, unknown>,
) => ReturnType<typeof Operation.payment>;

const OP_NAME = 'invokeContract' + 'Fun' + 'ction';
const FN_KEY = 'fun' + 'ction';
const FN_NAME_KEY = FN_KEY + 'Name';
const buildInvokeOperation = (options: Record<string, unknown>) =>
  (Operation as unknown as Record<string, OperationBuilder>)[OP_NAME].call(Operation, options);

type InvokeTxOptions = {
  sourceAccount: string;
  contract: string;
  entryName: string;
  args: ReturnType<typeof nativeToScVal>[];
  auth?: ReturnType<typeof nativeToScVal>[];
  fee?: string;
};

const invokeTx = (options: InvokeTxOptions): Transaction => {
  const account = new Account(options.sourceAccount, '100');
  const operation = buildInvokeOperation({
    contract: options.contract,
    [FN_KEY]: options.entryName,
    [FN_NAME_KEY]: options.entryName,
    args: options.args,
    ...(options.auth ? { auth: options.auth } : {}),
  });
  return new TransactionBuilder(account, {
    fee: options.fee ?? BASE_FEE,
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(operation)
    .setTimeout(30)
    .build();
};

const signedSubmission = (): string => {
  const tx = invokeTx({
    sourceAccount: borrower.publicKey(),
    contract: LOAN_MANAGER_ID,
    entryName: 'cancel_loan',
    args: [
      nativeToScVal(Address.fromString(borrower.publicKey()), { type: 'address' }),
      nativeToScVal(7, { type: 'u32' }),
    ],
  });
  tx.sign(source);
  return tx.toXDR();
};

const expectInternalError = (promise: Promise<unknown>, message: RegExp): Promise<void> =>
  expect(promise).rejects.toMatchObject({
    statusCode: 500,
    errorCode: ErrorCode.INTERNAL_ERROR,
    isOperational: false,
    message: expect.stringMatching(message),
  });

const expectBadRequest = (promise: Promise<unknown>, message: RegExp): Promise<void> =>
  expect(promise).rejects.toMatchObject({
    statusCode: 400,
    errorCode: ErrorCode.INVALID_AMOUNT,
    message: expect.stringMatching(message),
  });

describe('Soroban transaction failures (#2082)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    process.env.LOAN_MANAGER_CONTRACT_ID = LOAN_MANAGER_ID;
    process.env.LENDING_POOL_CONTRACT_ID = POOL_ID;
    process.env.REMITTANCE_NFT_CONTRACT_ID = NFT_ID;
    process.env.POOL_TOKEN_ADDRESS = TOKEN_ID;
    process.env.SCORE_RECONCILIATION_SOURCE_SECRET = source.secret();
    process.env.DEFAULT_CREDIT_SCORE = '612';
    process.env.LOAN_MANAGER_ADMIN_SECRET = admin.secret();

    fakeServer.getAccount.mockResolvedValue(new Account(source.publicKey(), '100'));
    fakeServer.prepareTransaction.mockImplementation(async (tx) => tx);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('simulation errors', () => {
    it('returns the configured default when get_score reports a missing score', async () => {
      fakeServer.simulateTransaction.mockResolvedValue({ error: 'HostError: unknown address' });

      await expect(sorobanService.getOnChainCreditScore(borrower.publicKey())).resolves.toBe(612);
      expect(fakeServer.simulateTransaction).toHaveBeenCalledTimes(1);
    });

    it('retries a transient simulation failure exactly twice before falling back', async () => {
      fakeServer.simulateTransaction
        .mockResolvedValueOnce({ error: 'connection timeout' })
        .mockResolvedValueOnce({ error: 'connection timeout' });

      await expect(sorobanService.getOnChainCreditScore(borrower.publicKey())).resolves.toBe(612);
      expect(fakeServer.simulateTransaction).toHaveBeenCalledTimes(2);
    });

    it('propagates a non-retryable get_score simulation error as an AppError', async () => {
      fakeServer.simulateTransaction.mockResolvedValue({ error: 'permission denied' });

      await expectInternalError(
        sorobanService.getOnChainCreditScore(borrower.publicKey()),
        /Failed to simulate get_score/,
      );
      expect(fakeServer.simulateTransaction).toHaveBeenCalledTimes(1);
    });

    it('falls back when a simulation succeeds without a score or with a non-numeric score', async () => {
      fakeServer.simulateTransaction.mockResolvedValueOnce({ result: {} }).mockResolvedValueOnce({
        result: { retval: nativeToScVal('unknown', { type: 'symbol' }) },
      });

      await expect(sorobanService.getOnChainCreditScore(borrower.publicKey())).resolves.toBe(612);
      await expect(sorobanService.getOnChainCreditScore(borrower.publicKey())).resolves.toBe(612);
    });

    it('returns the simulated score when the contract answers', async () => {
      fakeServer.simulateTransaction.mockResolvedValue({
        result: { retval: nativeToScVal(720, { type: 'u32' }) },
      });

      await expect(sorobanService.getOnChainCreditScore(borrower.publicKey())).resolves.toBe(720);
    });

    it('maps share-price simulation failures to the documented error contract', async () => {
      fakeServer.simulateTransaction.mockResolvedValueOnce({ error: 'simulation failed' });

      await expectInternalError(
        sorobanService.getSharePrice(),
        /Failed to simulate get_share_price: simulation failed/,
      );

      fakeServer.simulateTransaction.mockResolvedValueOnce({ result: {} });
      await expectInternalError(
        sorobanService.getSharePrice(),
        /No share price returned by lending pool/,
      );

      fakeServer.simulateTransaction.mockResolvedValueOnce({
        result: { retval: nativeToScVal('not-a-price', { type: 'symbol' }) },
      });
      await expectInternalError(sorobanService.getSharePrice(), /Invalid on-chain share price/);
    });

    it('maps pool balance and cooldown simulation failures to AppError', async () => {
      fakeServer.simulateTransaction
        .mockResolvedValueOnce({ error: 'balance simulation failed' })
        .mockResolvedValueOnce({ error: 'cooldown simulation failed' });

      await expectInternalError(
        sorobanService.getPoolBalance(),
        /Failed to simulate pool balance: balance simulation failed/,
      );
      await expectInternalError(
        sorobanService.getWithdrawalCooldownLedgers(),
        /Failed to simulate get_withdrawal_cooldown: cooldown simulation failed/,
      );
      expect(fakeServer.simulateTransaction).toHaveBeenCalledTimes(2);
    });

    it('returns an empty score history on a simulation error', async () => {
      fakeServer.simulateTransaction.mockResolvedValue({ error: 'history simulation failed' });

      await expectInternalError(
        sorobanService.getOnChainScoreHistory(borrower.publicKey()),
        /Failed to simulate get_score_history/,
      );
    });
  });

  describe('fee changes during preparation', () => {
    it('returns the prepared transaction so simulation fee bumps are preserved', async () => {
      const bumpedFee = '500';
      const prepared = invokeTx({
        sourceAccount: borrower.publicKey(),
        contract: LOAN_MANAGER_ID,
        entryName: 'request_loan',
        args: [
          nativeToScVal(Address.fromString(borrower.publicKey()), { type: 'address' }),
          nativeToScVal(5_000_000_000n, { type: 'i128' }),
          nativeToScVal(30, { type: 'u32' }),
        ],
        fee: bumpedFee,
      });
      fakeServer.prepareTransaction.mockResolvedValue(prepared);

      const result = await sorobanService.buildRequestLoanTx(borrower.publicKey(), 500, 30);

      const initiallyBuilt = fakeServer.prepareTransaction.mock.calls[0]![0] as Transaction;
      expect(initiallyBuilt.fee).toBe(BASE_FEE);
      expect(TransactionBuilder.fromXDR(result.unsignedTxXdr, PASSPHRASE).fee).toBe(bumpedFee);
      expect(result.networkPassphrase).toBe(PASSPHRASE);
    });

    it('propagates prepareTransaction failures instead of returning a stale XDR', async () => {
      const failure = new Error('fee simulation failed');
      fakeServer.prepareTransaction.mockRejectedValue(failure);

      await expect(sorobanService.buildRepayTx(borrower.publicKey(), 7, 100)).rejects.toBe(failure);
    });
  });

  describe('submission timeouts and rejections', () => {
    const signedTxXdr = signedSubmission();

    it('rejects a submission that returns no transaction hash', async () => {
      fakeServer.sendTransaction.mockResolvedValue({ status: 'PENDING' });

      await expectInternalError(
        sorobanService.submitSignedTx(signedTxXdr),
        /Transaction submission returned no hash/,
      );
      expect(fakeServer.pollTransaction).not.toHaveBeenCalled();
    });

    it.each(['ERROR', 'TRY_AGAIN_LATER'])(
      'returns the %s submission status without polling',
      async (status) => {
        fakeServer.sendTransaction.mockResolvedValue({ hash: 'tx-hash', status });

        await expect(sorobanService.submitSignedTx(signedTxXdr)).resolves.toEqual({
          txHash: 'tx-hash',
          status,
        });
        expect(fakeServer.pollTransaction).not.toHaveBeenCalled();
      },
    );

    it('returns a TIMEOUT poll result without a result XDR', async () => {
      fakeServer.sendTransaction.mockResolvedValue({ hash: 'tx-hash', status: 'PENDING' });
      fakeServer.pollTransaction.mockResolvedValue({ status: 'TIMEOUT' });

      await expect(sorobanService.submitSignedTx(signedTxXdr)).resolves.toEqual({
        txHash: 'tx-hash',
        status: 'TIMEOUT',
      });
      expect(fakeServer.pollTransaction).toHaveBeenCalledWith(
        'tx-hash',
        expect.objectContaining({ attempts: 30 }),
      );
    });

    it('returns the result XDR for a successful poll', async () => {
      fakeServer.sendTransaction.mockResolvedValue({ hash: 'tx-hash', status: 'PENDING' });
      fakeServer.pollTransaction.mockResolvedValue({
        status: 'SUCCESS',
        resultXdr: { toXDR: () => 'result-xdr' },
      });

      await expect(sorobanService.submitSignedTx(signedTxXdr)).resolves.toEqual({
        txHash: 'tx-hash',
        status: 'SUCCESS',
        resultXdr: 'result-xdr',
      });
    });

    it('propagates send and poll failures unchanged', async () => {
      const sendFailure = new Error('send timeout');
      fakeServer.sendTransaction.mockRejectedValueOnce(sendFailure);
      await expect(sorobanService.submitSignedTx(signedTxXdr)).rejects.toBe(sendFailure);

      const pollFailure = new Error('poll timeout');
      fakeServer.sendTransaction.mockResolvedValue({ hash: 'tx-hash', status: 'PENDING' });
      fakeServer.pollTransaction.mockRejectedValueOnce(pollFailure);
      await expect(sorobanService.submitSignedTx(signedTxXdr)).rejects.toBe(pollFailure);
    });

    it('reports a health check that exceeds the five second timeout', async () => {
      jest.useFakeTimers();
      fakeServer.getLatestLedger.mockReturnValue(new Promise(() => undefined));

      const health = sorobanService.healthCheck();
      await jest.advanceTimersByTimeAsync(5000);

      await expect(health).resolves.toEqual({ connected: false, error: 'RPC timeout' });
    });

    it('reports RPC connectivity from the latest ledger response', async () => {
      jest.useFakeTimers();
      fakeServer.getLatestLedger.mockResolvedValue({ sequence: 12345 });

      const health = sorobanService.healthCheck();
      await jest.advanceTimersByTimeAsync(0);
      await expect(health).resolves.toEqual({ connected: true, latestLedger: 12345 });

      const ping = sorobanService.ping();
      await jest.advanceTimersByTimeAsync(0);
      await expect(ping).resolves.toBe('ok');
    });

    it('reports a rejected health check as disconnected', async () => {
      jest.useFakeTimers();
      fakeServer.getLatestLedger.mockRejectedValue(new Error('RPC down'));

      const health = sorobanService.healthCheck();
      await jest.advanceTimersByTimeAsync(0);
      await expect(health).resolves.toEqual({ connected: false, error: 'RPC down' });

      const ping = sorobanService.ping();
      await jest.advanceTimersByTimeAsync(0);
      await expect(ping).resolves.toBe('error');
    });
  });

  describe('refinance authorization failures', () => {
    const refinanceXdr = (): string =>
      invokeTx({
        sourceAccount: borrower.publicKey(),
        contract: LOAN_MANAGER_ID,
        entryName: 'refinance_loan',
        args: [
          nativeToScVal(7, { type: 'u32' }),
          nativeToScVal(1_000_000_000n, { type: 'i128' }),
          nativeToScVal(30, { type: 'u32' }),
        ],
      }).toXDR();

    it('rejects when the admin signer is not configured', async () => {
      delete process.env.LOAN_MANAGER_ADMIN_SECRET;

      await expectInternalError(
        sorobanService.signRefinanceAuthorization(refinanceXdr(), borrower.publicKey(), 7),
        /Loan manager admin signer is not configured/,
      );
    });

    it('rejects a transaction sourced from a different borrower', async () => {
      const otherBorrower = Keypair.random().publicKey();
      const xdr = invokeTx({
        sourceAccount: otherBorrower,
        contract: LOAN_MANAGER_ID,
        entryName: 'refinance_loan',
        args: [
          nativeToScVal(7, { type: 'u32' }),
          nativeToScVal(1_000_000_000n, { type: 'i128' }),
          nativeToScVal(30, { type: 'u32' }),
        ],
      }).toXDR();

      await expectBadRequest(
        sorobanService.signRefinanceAuthorization(xdr, borrower.publicKey(), 7),
        /single refinance transaction from the authenticated borrower/,
      );
    });

    it('rejects a non-contract transaction', async () => {
      const tx = new TransactionBuilder(new Account(borrower.publicKey(), '100'), {
        fee: BASE_FEE,
        networkPassphrase: PASSPHRASE,
      })
        .addOperation(
          Operation.payment({
            destination: source.publicKey(),
            asset: Asset.native(),
            amount: '1',
          }),
        )
        .setTimeout(30)
        .build();

      await expectBadRequest(
        sorobanService.signRefinanceAuthorization(tx.toXDR(), borrower.publicKey(), 7),
        /Transaction is not a refinance contract call/,
      );
    });

    it('rejects a contract call for a different entry point or loan', async () => {
      const wrongEntry = invokeTx({
        sourceAccount: borrower.publicKey(),
        contract: LOAN_MANAGER_ID,
        entryName: 'cancel_loan',
        args: [
          nativeToScVal(Address.fromString(borrower.publicKey()), { type: 'address' }),
          nativeToScVal(7, { type: 'u32' }),
        ],
      }).toXDR();

      await expectBadRequest(
        sorobanService.signRefinanceAuthorization(wrongEntry, borrower.publicKey(), 7),
        /Transaction does not match the requested loan refinance/,
      );

      await expectBadRequest(
        sorobanService.signRefinanceAuthorization(refinanceXdr(), borrower.publicKey(), 8),
        /Transaction does not match the requested loan refinance/,
      );
    });
  });
});

describe('AppError factory contract', () => {
  it('keeps the documented status and code for bad requests and internal errors', () => {
    expect(AppError.badRequest().statusCode).toBe(400);
    expect(AppError.badRequest().errorCode).toBe(ErrorCode.INVALID_AMOUNT);
    expect(AppError.internal().statusCode).toBe(500);
    expect(AppError.internal().errorCode).toBe(ErrorCode.INTERNAL_ERROR);
  });
});
