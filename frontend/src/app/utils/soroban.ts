"use client";

import {
  Address,
  nativeToScVal,
  Operation,
  rpc,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";

const DEFAULT_RPC_URL = "https://soroban-testnet.stellar.org";
const DEFAULT_NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";

interface BuildLoanRequestXdrParams {
  borrower: string;
  amount: number;
  term: number;
  contractId: string;
  rpcUrl?: string;
  networkPassphrase?: string;
}

interface BuildRepaymentXdrParams {
  borrower: string;
  loanId: string;
  amount: number;
  contractId: string;
  rpcUrl?: string;
  networkPassphrase?: string;
}

export async function buildUnsignedLoanRequestXdr({
  borrower,
  amount,
  term,
  contractId,
  rpcUrl = process.env.NEXT_PUBLIC_STELLAR_RPC_URL ?? DEFAULT_RPC_URL,
  networkPassphrase = process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE ??
    DEFAULT_NETWORK_PASSPHRASE,
}: BuildLoanRequestXdrParams): Promise<string> {
  const server = new rpc.Server(rpcUrl);
  const source = await server.getAccount(borrower);
  const amountScVal = nativeToScVal(BigInt(Math.floor(amount)), { type: "i128" });
  const termScVal = nativeToScVal(BigInt(term), { type: "u32" });
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
  rpcUrl = process.env.NEXT_PUBLIC_STELLAR_RPC_URL ?? DEFAULT_RPC_URL,
  networkPassphrase = process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE ??
    DEFAULT_NETWORK_PASSPHRASE,
}: BuildRepaymentXdrParams): Promise<string> {
  const server = new rpc.Server(rpcUrl);
  const source = await server.getAccount(borrower);

  const borrowerScVal = new Address(borrower).toScVal();
  const loanIdScVal = nativeToScVal(BigInt(loanId), { type: "u64" });
  const amountScVal = nativeToScVal(BigInt(Math.floor(amount)), { type: "i128" });

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
