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

describe('SorobanService withdraw & emergency_withdraw', () => {
  const providerKeypair = Keypair.random();
  const providerAddress = providerKeypair.publicKey();
  const tokenAddress = StrKey.encodeContract(Buffer.alloc(32, 2));
  const poolContractId = StrKey.encodeContract(Buffer.alloc(32, 1));

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.LENDING_POOL_CONTRACT_ID = poolContractId;
    process.env.STELLAR_NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
    process.env.SOROBAN_RPC_URL = 'https://soroban-testnet.stellar.org';

    const account = new Account(providerAddress, '100');
    mockGetAccount.mockResolvedValue(account);
    mockPrepareTransaction.mockImplementation(async (tx) => tx);
  });

  describe('buildWithdrawTx', () => {
    it('passes 4 arguments (provider, token, shares, min_assets_out) to withdraw invocation with default minAssetsOut=0', async () => {
      const result = await sorobanService.buildWithdrawTx(providerAddress, tokenAddress, 1000);

      expect(result).toHaveProperty('unsignedTxXdr');
      expect(result).toHaveProperty('networkPassphrase');

      expect(mockPrepareTransaction).toHaveBeenCalled();
      const passedTx = mockPrepareTransaction.mock.calls[0][0];
      const op = passedTx.operations[0];

      expect(op.type).toBe('invokeHostFunction');
      const hostFn = op.func;
      expect(hostFn.switch().name).toBe('hostFunctionTypeInvokeContract');

      const invokeContractArgs = hostFn.invokeContract();
      const functionName = invokeContractArgs.functionName().toString();
      const args = invokeContractArgs.args();

      expect(functionName).toBe('withdraw');
      expect(args.length).toBe(4);
      expect(scValToNative(args[2])).toBe(1000n);
      expect(scValToNative(args[3])).toBe(0n);
    });

    it('passes explicit minAssetsOut as the 4th argument to withdraw invocation', async () => {
      const result = await sorobanService.buildWithdrawTx(providerAddress, tokenAddress, 1000, 950);

      expect(result).toHaveProperty('unsignedTxXdr');

      expect(mockPrepareTransaction).toHaveBeenCalled();
      const passedTx = mockPrepareTransaction.mock.calls[0][0];
      const op = passedTx.operations[0];
      const invokeContractArgs = op.func.invokeContract();

      expect(invokeContractArgs.functionName().toString()).toBe('withdraw');
      const args = invokeContractArgs.args();
      expect(args.length).toBe(4);
      expect(scValToNative(args[2])).toBe(1000n);
      expect(scValToNative(args[3])).toBe(9_500_000_000n);
    });
  });

  describe('buildEmergencyWithdrawTx', () => {
    it('passes 4 arguments (provider, token, shares, min_assets_out) to emergency_withdraw invocation with default minAssetsOut=0', async () => {
      const result = await sorobanService.buildEmergencyWithdrawTx(
        providerAddress,
        tokenAddress,
        500,
      );

      expect(result).toHaveProperty('unsignedTxXdr');
      expect(result).toHaveProperty('networkPassphrase');

      expect(mockPrepareTransaction).toHaveBeenCalled();
      const passedTx = mockPrepareTransaction.mock.calls[0][0];
      const op = passedTx.operations[0];
      const invokeContractArgs = op.func.invokeContract();

      expect(invokeContractArgs.functionName().toString()).toBe('emergency_withdraw');
      const args = invokeContractArgs.args();
      expect(args.length).toBe(4);
      expect(scValToNative(args[2])).toBe(500n);
      expect(scValToNative(args[3])).toBe(0n);
    });

    it('passes explicit minAssetsOut as the 4th argument to emergency_withdraw invocation', async () => {
      const result = await sorobanService.buildEmergencyWithdrawTx(
        providerAddress,
        tokenAddress,
        500,
        480,
      );

      expect(result).toHaveProperty('unsignedTxXdr');

      expect(mockPrepareTransaction).toHaveBeenCalled();
      const passedTx = mockPrepareTransaction.mock.calls[0][0];
      const op = passedTx.operations[0];
      const invokeContractArgs = op.func.invokeContract();

      expect(invokeContractArgs.functionName().toString()).toBe('emergency_withdraw');
      const args = invokeContractArgs.args();
      expect(args.length).toBe(4);
      expect(scValToNative(args[2])).toBe(500n);
      expect(scValToNative(args[3])).toBe(4_800_000_000n);
    });
  });
});
