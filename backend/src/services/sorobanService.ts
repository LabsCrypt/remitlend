import {
  BASE_FEE,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  Address,
  xdr,
  StrKey,
} from "@stellar/stellar-sdk";
import logger from "../utils/logger.js";
import { AppError } from "../errors/AppError.js";
import {
  createSorobanRpcServer,
  getStellarNetworkPassphrase,
} from "../config/stellar.js";

function rpcCall<T>(promise: Promise<T>): Promise<T> {
  return promise.catch((err: unknown) => {
    if (err instanceof Error && err.name === "AbortError") {
      throw AppError.internal("Stellar RPC request timed out");
    }
    throw err;
  });
}

/**
 * Service for building and submitting Soroban contract transactions.
 * Handles the transaction lifecycle: build → (frontend signs) → submit.
 */
class SorobanService {
  private getRpcServer() {
    return createSorobanRpcServer();
  }

  private getNetworkPassphrase(): string {
    return getStellarNetworkPassphrase();
  }

  private getLoanManagerContractId(): string {
    const contractId = process.env.LOAN_MANAGER_CONTRACT_ID;
    if (!contractId) {
      throw AppError.internal(
        "LOAN_MANAGER_CONTRACT_ID is not configured",
      );
    }
    return contractId;
  }

  private getLendingPoolContractId(): string {
    const contractId = process.env.LENDING_POOL_CONTRACT_ID;
    if (!contractId) {
      throw AppError.internal(
        "LENDING_POOL_CONTRACT_ID is not configured",
      );
    }
    return contractId;
  }

  private getPoolTokenAddress(): string {
    const address = process.env.POOL_TOKEN_ADDRESS;
    if (!address) {
      throw AppError.internal(
        "POOL_TOKEN_ADDRESS is not configured",
      );
    }
    return address;
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

    const account = await rpcCall(server.getAccount(borrowerPublicKey));

    const borrowerScVal = nativeToScVal(
      Address.fromString(borrowerPublicKey),
      { type: "address" },
    );
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

    const prepared = await rpcCall(server.prepareTransaction(tx));
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

    const account = await rpcCall(server.getAccount(borrowerPublicKey));

    const borrowerScVal = nativeToScVal(
      Address.fromString(borrowerPublicKey),
      { type: "address" },
    );
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

    const prepared = await rpcCall(server.prepareTransaction(tx));
    const unsignedTxXdr = prepared.toXDR();

    logger.info("Built repay transaction", {
      borrower: borrowerPublicKey,
      loanId,
      amount,
    });

    return { unsignedTxXdr, networkPassphrase: passphrase };
  }

  /**
   * Builds an unsigned Soroban `deposit(provider, token, amount)` transaction
   * against the LendingPool contract.
   * Returns base64 XDR for the frontend to sign with the user's wallet.
   */
  async buildDepositTx(
    depositorPublicKey: string,
    amount: number,
  ): Promise<{ unsignedTxXdr: string; networkPassphrase: string }> {
    const server = this.getRpcServer();
    const contractId = this.getLendingPoolContractId();
    const passphrase = this.getNetworkPassphrase();

    const account = await rpcCall(server.getAccount(depositorPublicKey));

    const providerScVal = nativeToScVal(
      Address.fromString(depositorPublicKey),
      { type: "address" },
    );
    const tokenScVal = nativeToScVal(
      Address.fromString(this.getPoolTokenAddress()),
      { type: "address" },
    );
    const amountScVal = nativeToScVal(BigInt(amount), { type: "i128" });

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: passphrase,
    })
      .addOperation(
        Operation.invokeContractFunction({
          contract: contractId,
          function: "deposit",
          args: [providerScVal, tokenScVal, amountScVal],
        }),
      )
      .setTimeout(30)
      .build();

    const prepared = await rpcCall(server.prepareTransaction(tx));
    const unsignedTxXdr = prepared.toXDR();

    logger.info("Built deposit transaction", {
      depositor: depositorPublicKey,
      amount,
    });

    return { unsignedTxXdr, networkPassphrase: passphrase };
  }

  /**
   * Builds an unsigned Soroban `withdraw(provider, token, shares)` transaction
   * against the LendingPool contract.
   * Returns base64 XDR for the frontend to sign with the user's wallet.
   */
  async buildWithdrawTx(
    depositorPublicKey: string,
    shares: number,
  ): Promise<{ unsignedTxXdr: string; networkPassphrase: string }> {
    const server = this.getRpcServer();
    const contractId = this.getLendingPoolContractId();
    const passphrase = this.getNetworkPassphrase();

    const account = await rpcCall(server.getAccount(depositorPublicKey));

    const providerScVal = nativeToScVal(
      Address.fromString(depositorPublicKey),
      { type: "address" },
    );
    const tokenScVal = nativeToScVal(
      Address.fromString(this.getPoolTokenAddress()),
      { type: "address" },
    );
    const sharesScVal = nativeToScVal(BigInt(shares), { type: "i128" });

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: passphrase,
    })
      .addOperation(
        Operation.invokeContractFunction({
          contract: contractId,
          function: "withdraw",
          args: [providerScVal, tokenScVal, sharesScVal],
        }),
      )
      .setTimeout(30)
      .build();

    const prepared = await rpcCall(server.prepareTransaction(tx));
    const unsignedTxXdr = prepared.toXDR();

    logger.info("Built withdraw transaction", {
      depositor: depositorPublicKey,
      shares,
    });

    return { unsignedTxXdr, networkPassphrase: passphrase };
  }

  /**
   * Builds an unsigned Soroban `approve_loan(loan_id)` transaction
   * against the LoanManager contract.
   * Returns base64 XDR for the admin to sign with their wallet.
   */
  async buildApproveLoanTx(
    adminPublicKey: string,
    loanId: number,
  ): Promise<{ unsignedTxXdr: string; networkPassphrase: string }> {
    const server = this.getRpcServer();
    const contractId = this.getLoanManagerContractId();
    const passphrase = this.getNetworkPassphrase();

    const account = await rpcCall(server.getAccount(adminPublicKey));

    const loanIdScVal = nativeToScVal(loanId, { type: "u32" });

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: passphrase,
    })
      .addOperation(
        Operation.invokeContractFunction({
          contract: contractId,
          function: "approve_loan",
          args: [loanIdScVal],
        }),
      )
      .setTimeout(30)
      .build();

    const prepared = await rpcCall(server.prepareTransaction(tx));
    const unsignedTxXdr = prepared.toXDR();

    logger.info("Built approve_loan transaction", {
      admin: adminPublicKey,
      loanId,
    });

    return { unsignedTxXdr, networkPassphrase: passphrase };
  }

  /**
   * Validates all required Soroban configuration on startup.
   * Checks that each contract ID is present and is a valid Stellar contract
   * address, then confirms RPC connectivity with a lightweight health call.
   * Throws AppError.internal() with a clear message on any failure so the
   * caller (index.ts) can log and exit before the server accepts traffic.
   */
  async validateConfig(): Promise<void> {
    const contractChecks: Array<[string, string]> = [
      ["LOAN_MANAGER_CONTRACT_ID", process.env.LOAN_MANAGER_CONTRACT_ID ?? ""],
      ["LENDING_POOL_CONTRACT_ID", process.env.LENDING_POOL_CONTRACT_ID ?? ""],
      ["POOL_TOKEN_ADDRESS",       process.env.POOL_TOKEN_ADDRESS       ?? ""],
    ];

    for (const [name, value] of contractChecks) {
      if (!value) {
        throw AppError.internal(`${name} is not configured`);
      }
      if (!StrKey.isValidContract(value)) {
        throw AppError.internal(
          `${name} is not a valid Stellar contract address: "${value}"`,
        );
      }
    }

    try {
      await rpcCall(this.getRpcServer().getHealth());
    } catch (err) {
      throw AppError.internal(
        `Stellar RPC is unreachable at ${process.env.STELLAR_RPC_URL || "https://soroban-testnet.stellar.org"}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    logger.info("Soroban configuration validated", {
      loanManagerContractId: process.env.LOAN_MANAGER_CONTRACT_ID,
      lendingPoolContractId: process.env.LENDING_POOL_CONTRACT_ID,
      rpcUrl:
        process.env.STELLAR_RPC_URL || "https://soroban-testnet.stellar.org",
    });
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

    const sendResult = await rpcCall(server.sendTransaction(tx));
    const txHash = sendResult.hash;

    if (!txHash) {
      throw AppError.internal("Transaction submission returned no hash");
    }

    logger.info("Transaction submitted", {
      txHash,
      status: sendResult.status,
    });

    // Poll for final result
    const polled = await rpcCall(server.pollTransaction(txHash, {
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
  /**
   * Ping the Stellar RPC server to verify connectivity.
   * Returns "ok" on success or "error" if unreachable.
   */
  async ping(): Promise<"ok" | "error"> {
    try {
      const server = this.getRpcServer();
      await rpcCall(server.getHealth());
      return "ok";
    } catch {
      return "error";
    }
  }

  /**
   * Returns score adjustment constants for indexing.
   * Values are sourced from environment variables so they stay in sync
   * with the deployed RemittanceNFT contract constants without requiring
   * a hardcoded value in application logic.
   */
  getScoreConfig(): { repaymentDelta: number; defaultPenalty: number } {
    const repaymentDelta = parseInt(
      process.env.SCORE_REPAYMENT_DELTA ?? "15",
      10,
    );
    const defaultPenalty = parseInt(
      process.env.SCORE_DEFAULT_PENALTY ?? "50",
      10,
    );
    return { repaymentDelta, defaultPenalty };
  }
  
}

export const sorobanService = new SorobanService();
