import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import {
  Account,
  FeeBumpTransaction,
  Keypair,
  StrKey,
  Transaction,
  scValToNative,
} from '@stellar/stellar-sdk';

const mockGetAccount = jest.fn<() => Promise<Account>>();
const mockPrepareTransaction =
  jest.fn<(tx: Transaction | FeeBumpTransaction) => Promise<Transaction | FeeBumpTransaction>>();

const mockRpcServer = {
  getAccount: mockGetAccount,
  prepareTransaction: mockPrepareTransaction,
};

jest.unstable_mockModule('@stellar/stellar-sdk', async () => {
  const actual =
    await jest.requireActual<typeof import('@stellar/stellar-sdk')>('@stellar/stellar-sdk');
  return {
    ...actual,
    rpc: {
      ...actual.rpc,
      Server: jest.fn(() => mockRpcServer),
    },
  };
});

const { sorobanService } = await import('../sorobanService.js');

describe('SorobanService loan manager tx builders', () => {
  const keypair = Keypair.random();
  const address = keypair.publicKey();

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.LOAN_MANAGER_CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 3));
    process.env.STELLAR_NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
    process.env.SOROBAN_RPC_URL = 'https://soroban-testnet.stellar.org';

    mockGetAccount.mockResolvedValue(new Account(address, '100'));
    mockPrepareTransaction.mockImplementation(async (tx) => tx);
  });

  const invokedArgs = () => {
    const passedTx = mockPrepareTransaction.mock.calls[0][0] as Transaction;
    const invokeContractArgs = passedTx.operations[0].func.invokeContract();
    return {
      functionName: invokeContractArgs.functionName().toString(),
      args: invokeContractArgs.args(),
    };
  };

  it('buildCancelLoanTx passes (borrower, loan_id: u32) to cancel_loan', async () => {
    await sorobanService.buildCancelLoanTx(address, '7');

    const { functionName, args } = invokedArgs();
    expect(functionName).toBe('cancel_loan');
    expect(args.length).toBe(2);
    expect(scValToNative(args[0])).toBe(address);
    expect(args[1].switch().name).toBe('scvU32');
    expect(scValToNative(args[1])).toBe(7);
  });

  it('buildRejectLoanTx passes (loan_id: u32, reason: string) to reject_loan', async () => {
    await sorobanService.buildRejectLoanTx(address, '7', 'insufficient history');

    const { functionName, args } = invokedArgs();
    expect(functionName).toBe('reject_loan');
    expect(args.length).toBe(2);
    expect(args[0].switch().name).toBe('scvU32');
    expect(scValToNative(args[0])).toBe(7);
    expect(args[1].switch().name).toBe('scvString');
    expect(scValToNative(args[1])).toBe('insufficient history');
  });
});
