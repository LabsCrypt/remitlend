"use client";

import {
  Address,
  nativeToScVal,
  Operation,
  rpc,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { DEFAULT_NETWORK_PASSPHRASE, getNetworkPassphrase } from "./networkPassphrase";

export { DEFAULT_NETWORK_PASSPHRASE, getNetworkPassphrase };

const DEFAULT_RPC_URL = "https://soroban-testnet.stellar.org";

const DEFAULT_CONFIRMATION_TIMEOUT_MS = 60_000;
const DEFAULT_CONFIRMATION_POLL_INTERVAL_MS = 2_000;

/**
 * Wait until Soroban has indexed a submitted transaction.
 *
 * A successful submission only means that the RPC accepted the transaction;
 * callers must wait for `getTransaction` to report SUCCESS before refreshing
 * balances. FAILED is surfaced as an error and NOT_FOUND is retried until the
 * timeout because indexing can lag immediately after submission.
 */
export async function waitForSorobanTransaction(
  txHash: string,
  options: {
    rpcUrl?: string;
    timeoutMs?: number;
    pollIntervalMs?: number;
  } = {},
): Promise<void> {
  const server = new rpc.Server(
    options.rpcUrl ?? process.env.NEXT_PUBLIC_STELLAR_RPC_URL ?? DEFAULT_RPC_URL,
  );
  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_CONFIRMATION_TIMEOUT_MS);
  const pollInterval = options.pollIntervalMs ?? DEFAULT_CONFIRMATION_POLL_INTERVAL_MS;

  while (Date.now() <= deadline) {
    const result = await server.getTransaction(txHash);
    if (result.status === "SUCCESS") return;
    if (result.status === "FAILED") {
      throw new Error(`Soroban transaction ${txHash} failed on-chain`);
    }

    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, pollInterval));
  }

  throw new Error(`Timed out waiting for Soroban transaction ${txHash} to confirm`);
}

interface BuildLoanRequestXdrParams {
  borrower: string;
  amount: number;
  term: number;
  contractId: string;
  decimals?: number;
  rpcUrl?: string;
  networkPassphrase?: string;
}

interface BuildRepaymentXdrParams {
  borrower: string;
  loanId: string;
  amount: number;
  contractId: string;
  decimals?: number;
  rpcUrl?: string;
  networkPassphrase?: string;
}

export async function buildUnsignedLoanRequestXdr({
  borrower,
  amount,
  term,
  contractId,
  decimals = STROOP_DECIMALS,
  rpcUrl = process.env.NEXT_PUBLIC_STELLAR_RPC_URL ?? DEFAULT_RPC_URL,
  networkPassphrase = process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE ??
    DEFAULT_NETWORK_PASSPHRASE,
}: BuildLoanRequestXdrParams): Promise<string> {
  const server = new rpc.Server(rpcUrl);
  const source = await server.getAccount(borrower);
  const scaledAmount = toStroops(String(Math.floor(amount)), decimals);
  if (scaledAmount === null) {
    throw new Error(`Invalid amount for ${decimals}-decimal asset: ${amount}`);
  }
  const amountScVal = nativeToScVal(scaledAmount, { type: "i128" });
  const termScVal = nativeToScVal(term, { type: "u32" });
  const borrowerScVal = new Address(borrower).toScVal();

  const tx = new TransactionBuilder(source, {
    fee: "10000",
    networkPassphrase,
  })
    .addOperation(
      Operation.invokeHostFunction({
        func: xdr.HostFunction.hostFunctionTypeInvokeContract(
          new xdr.InvokeContractArgs({
            contractAddress: Address.fromString(contractId).toScAddress(),
            functionName: "request_loan",
            args: [borrowerScVal, amountScVal, termScVal],
          }),
        ),
        auth: [],
      }),
    )
    .setTimeout(300)
    .build();

  return tx.toXDR();
}

export async function buildUnsignedRepaymentXdr({
  borrower,
  loanId,
  amount,
  contractId,
  decimals = STROOP_DECIMALS,
  rpcUrl = process.env.NEXT_PUBLIC_STELLAR_RPC_URL ?? DEFAULT_RPC_URL,
  networkPassphrase = process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE ??
    DEFAULT_NETWORK_PASSPHRASE,
}: BuildRepaymentXdrParams): Promise<string> {
  const server = new rpc.Server(rpcUrl);
  const source = await server.getAccount(borrower);

  const borrowerScVal = new Address(borrower).toScVal();
  const loanIdScVal = nativeToScVal(BigInt(loanId), { type: "u64" });
  const scaledAmount = toStroops(String(Math.floor(amount)), decimals);
  if (scaledAmount === null) {
    throw new Error(`Invalid amount for ${decimals}-decimal asset: ${amount}`);
  }
  const amountScVal = nativeToScVal(scaledAmount, { type: "i128" });

  const tx = new TransactionBuilder(source, {
    fee: "10000",
    networkPassphrase,
  })
    .addOperation(
      Operation.invokeHostFunction({
        func: xdr.HostFunction.hostFunctionTypeInvokeContract(
          new xdr.InvokeContractArgs({
            contractAddress: Address.fromString(contractId).toScAddress(),
            functionName: "repay",
            args: [borrowerScVal, loanIdScVal, amountScVal],
          }),
        ),
        auth: [],
      }),
    )
    .setTimeout(300)
    .build();

  return tx.toXDR();
}
