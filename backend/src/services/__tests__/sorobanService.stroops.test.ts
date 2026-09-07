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

describe('SorobanService token amounts are scaled to stroops (10^7)', () => {
  const userKeypair = Keypair.random();
  const userAddress = userKeypair.publicKey();
  const tokenAddress = StrKey.encodeContract(Buffer.alloc(32, 2));
  const loanManagerContractId = StrKey.encodeContract(Buffer.alloc(32, 3));
  const lendingPoolContractId = StrKey.encodeContract(Buffer.alloc(32, 4));

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.LOAN_MANAGER_CONTRACT_ID = loanManagerContractId;
    process.env.LENDING_POOL_CONTRACT_ID = lendingPoolContractId;
    process.env.STELLAR_NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
    process.env.SOROBAN_RPC_URL = 'https://soroban-testnet.stellar.org';

    const account = new Account(userAddress, '100');
    mockGetAccount.mockResolvedValue(account);
    mockPrepareTransaction.mockImplementation(async (tx) => tx);
  });

  async function invokeArgsFor(
    build: () => Promise<{ unsignedTxXdr: string; networkPassphrase: string }>,
  ) {
    await build();
    const passedTx = mockPrepareTransaction.mock.calls[0][0];
    const op = passedTx.operations[0];
    const invokeContractArgs = op.func.invokeContract();
    return {
      functionName: invokeContractArgs.functionName().toString(),
      args: invokeContractArgs.args(),
    };
  }

  it('buildRequestLoanTx scales the amount to stroops', async () => {
    const { functionName, args } = await invokeArgsFor(() =>
      sorobanService.buildRequestLoanTx(userAddress, 500),
    );

    expect(functionName).toBe('request_loan');
    expect(scValToNative(args[1])).toBe(5_000_000_000n);
  });

  it('buildRepayTx scales the amount to stroops', async () => {
    const { functionName, args } = await invokeArgsFor(() =>
      sorobanService.buildRepayTx(userAddress, 42, 120.5),
    );

    expect(functionName).toBe('repay');
    expect(scValToNative(args[1])).toBe(42);
    expect(scValToNative(args[2])).toBe(1_205_000_000n);
  });

  it('buildDepositTx scales the amount to stroops', async () => {
    const { functionName, args } = await invokeArgsFor(() =>
      sorobanService.buildDepositTx(userAddress, tokenAddress, 12.5, 0),
    );

    expect(functionName).toBe('deposit');
    expect(scValToNative(args[2])).toBe(125_000_000n);
  });

  it('buildRefinanceLoanTx scales the new amount to stroops', async () => {
    const { functionName, args } = await invokeArgsFor(() =>
      sorobanService.buildRefinanceLoanTx(userAddress, 7, 2500, 30),
    );

    expect(functionName).toBe('refinance_loan');
    expect(scValToNative(args[1])).toBe(25_000_000_000n);
    expect(scValToNative(args[2])).toBe(30);
  });
});
