import {
  BASE_FEE,
  Networks,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  Address,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import logger from "../utils/logger.js";
import { AppError } from "../errors/AppError.js";

/**
 * Service for building and submitting Soroban contract transactions.
 * Handles the transaction lifecycle: build → (frontend signs) → submit.
 */
class SorobanService {
  private getRpcServer(): rpc.Server {
    const rpcUrl =
      process.env.STELLAR_RPC_URL || "https://soroban-testnet.stellar.org";
    const allowHttp = rpcUrl.startsWith("http://");
    return new rpc.Server(rpcUrl, { allowHttp });
  }

  private getNetworkPassphrase(): string {
    return process.env.STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET;
  }

  private getLoanManagerContractId(): string {
    const contractId = process.env.LOAN_MANAGER_CONTRACT_ID;
    if (!contractId) {
      throw AppError.internal("LOAN_MANAGER_CONTRACT_ID is not configured");
    }
    return contractId;
  }

  /**
   * Builds an unsigned Soroban `request_loan(borrower, amount)` transaction.
   * Returns base64 XDR for the frontend to sign with the user's wallet.
   */
  async buildRequestLoanTx(
    borrowerPublicKey: string,
    amount: number,
  ): Promise<{ unsignedTxXdr: string; networkPassphrase: string }> {
    const server = this.getRpcServer();
    const contractId = this.getLoanManagerContractId();
    const passphrase = this.getNetworkPassphrase();

    const account = await server.getAccount(borrowerPublicKey);

    const borrowerScVal = nativeToScVal(Address.fromString(borrowerPublicKey), {
      type: "address",
    });
    const amountScVal = nativeToScVal(BigInt(amount), { type: "i128" });

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: passphrase,
    })
      .addOperation(
        Operation.invokeContractFunction({
          contract: contractId,
          function: "request_loan",
          args: [borrowerScVal, amountScVal],
        }),
      )
      .setTimeout(30)
      .build();

    const prepared = await server.prepareTransaction(tx);
    const unsignedTxXdr = prepared.toXDR();

    logger.info("Built request_loan transaction", {
      borrower: borrowerPublicKey,
      amount,
    });

    return { unsignedTxXdr, networkPassphrase: passphrase };
  }

  /**
   * Builds an unsigned Soroban `repay(borrower, loan_id, amount)` transaction.
   * Returns base64 XDR for the frontend to sign with the user's wallet.
   */
  async buildRepayTx(
    borrowerPublicKey: string,
    loanId: number,
    amount: number,
  ): Promise<{ unsignedTxXdr: string; networkPassphrase: string }> {
    const server = this.getRpcServer();
    const contractId = this.getLoanManagerContractId();
    const passphrase = this.getNetworkPassphrase();

    const account = await server.getAccount(borrowerPublicKey);

    const borrowerScVal = nativeToScVal(Address.fromString(borrowerPublicKey), {
      type: "address",
    });
    const loanIdScVal = nativeToScVal(loanId, { type: "u32" });
    const amountScVal = nativeToScVal(BigInt(amount), { type: "i128" });

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: passphrase,
    })
      .addOperation(
        Operation.invokeContractFunction({
          contract: contractId,
          function: "repay",
          args: [borrowerScVal, loanIdScVal, amountScVal],
        }),
      )
      .setTimeout(30)
      .build();

    const prepared = await server.prepareTransaction(tx);
    const unsignedTxXdr = prepared.toXDR();

    logger.info("Built repay transaction", {
      borrower: borrowerPublicKey,
      loanId,
      amount,
    });

    return { unsignedTxXdr, networkPassphrase: passphrase };
  }

  /**
   * Submits a signed transaction XDR to the Stellar network and polls
   * for the result.
   */
  async submitSignedTx(signedTxXdr: string): Promise<{
    txHash: string;
    status: string;
    resultXdr?: string;
  }> {
    const server = this.getRpcServer();

    const tx = TransactionBuilder.fromXDR(
      signedTxXdr,
      this.getNetworkPassphrase(),
    );

    const sendResult = await server.sendTransaction(tx);
    const txHash = sendResult.hash;

    if (!txHash) {
      throw AppError.internal("Transaction submission returned no hash");
    }

    logger.info("Transaction submitted", {
      txHash,
      status: sendResult.status,
    });

    // Poll for final result
    const polled = await server.pollTransaction(txHash, {
      attempts: 30,
      sleepStrategy: () => 1000,
    });

    const resultXdr =
      polled.status === "SUCCESS" && polled.resultXdr
        ? polled.resultXdr.toXDR("base64")
        : undefined;

    return {
      txHash,
      status: polled.status,
      ...(resultXdr !== undefined ? { resultXdr } : {}),
    };
  }
}

export const sorobanService = new SorobanService();
