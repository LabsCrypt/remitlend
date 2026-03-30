import {
  BASE_FEE,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  Address,
  StrKey,
  Keypair,
} from "@stellar/stellar-sdk";
import logger from "../utils/logger.js";
import { AppError } from "../errors/AppError.js";
import {
  createSorobanRpcServer,
  getStellarNetworkPassphrase,
  getStellarRpcUrl,
} from "../config/stellar.js";

/**
 * Service for building and submitting Soroban contract transactions.
 * Handles the transaction lifecycle: build → (frontend signs) → submit.
 */
class SorobanService {
  private getRpcServer() {
    return createSorobanRpcServer();
  }

  async ping(): Promise<"ok" | "error"> {
    const result = await this.healthCheck();
    return result.connected ? "ok" : "error";
  }

  private getNetworkPassphrase(): string {
    return getStellarNetworkPassphrase();
  }

  private getLoanManagerContractId(): string {
    const contractId = process.env.LOAN_MANAGER_CONTRACT_ID;
    if (!contractId) {
      throw AppError.internal("LOAN_MANAGER_CONTRACT_ID is not configured");
    }
    return contractId;
  }

  private getLendingPoolContractId(): string {
    const contractId = process.env.LENDING_POOL_CONTRACT_ID;
    if (!contractId) {
      throw AppError.internal("LENDING_POOL_CONTRACT_ID is not configured");
    }
    return contractId;
  }

  private getPoolTokenAddress(): string {
    const address = process.env.POOL_TOKEN_ADDRESS;
    if (!address) {
      throw AppError.internal("POOL_TOKEN_ADDRESS is not configured");
    }
    return address;
  }

  private getRemittanceNftContractId(): string {
    const contractId = process.env.REMITTANCE_NFT_CONTRACT_ID;
    if (!contractId) {
      throw AppError.internal("REMITTANCE_NFT_CONTRACT_ID is not configured");
    }
    return contractId;
  }

  private getScoreReadSourceKeypair(): Keypair {
    const secret =
      process.env.SCORE_RECONCILIATION_SOURCE_SECRET ??
      process.env.LOAN_MANAGER_ADMIN_SECRET;

    if (!secret) {
      throw AppError.internal(
        "A source secret is required for score reconciliation reads",
      );
    }

    try {
      return Keypair.fromSecret(secret);
    } catch {
      throw AppError.internal(
        "The configured score reconciliation source secret is invalid",
      );
    }
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
   * Builds an unsigned Soroban `deposit(provider, token, amount)` transaction
   * against the LendingPool contract.
   * Returns base64 XDR for the frontend to sign with the user's wallet.
   */
  async buildDepositTx(
    providerPublicKey: string,
    tokenAddress: string,
    amount: number,
  ): Promise<{ unsignedTxXdr: string; networkPassphrase: string }> {
    const server = this.getRpcServer();
    const contractId = this.getLendingPoolContractId();
    const passphrase = this.getNetworkPassphrase();

    const account = await server.getAccount(providerPublicKey);

    const providerScVal = nativeToScVal(Address.fromString(providerPublicKey), {
      type: "address",
    });
    const tokenScVal = nativeToScVal(Address.fromString(tokenAddress), {
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
          function: "deposit",
          args: [providerScVal, tokenScVal, amountScVal],
        }),
      )
      .setTimeout(30)
      .build();

    const prepared = await server.prepareTransaction(tx);
    const unsignedTxXdr = prepared.toXDR();

    logger.info("Built deposit transaction", {
      provider: providerPublicKey,
      token: tokenAddress,
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
    providerPublicKey: string,
    tokenAddress: string,
    shares: number,
  ): Promise<{ unsignedTxXdr: string; networkPassphrase: string }> {
    const server = this.getRpcServer();
    const contractId = this.getLendingPoolContractId();
    const passphrase = this.getNetworkPassphrase();

    const account = await server.getAccount(providerPublicKey);

    const providerScVal = nativeToScVal(Address.fromString(providerPublicKey), {
      type: "address",
    });
    const tokenScVal = nativeToScVal(Address.fromString(tokenAddress), {
      type: "address",
    });
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

    const prepared = await server.prepareTransaction(tx);
    const unsignedTxXdr = prepared.toXDR();

    logger.info("Built withdraw transaction", {
      provider: providerPublicKey,
      token: tokenAddress,
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

    const account = await server.getAccount(adminPublicKey);

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

    const prepared = await server.prepareTransaction(tx);
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
      ["POOL_TOKEN_ADDRESS", process.env.POOL_TOKEN_ADDRESS ?? ""],
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

    let rpcUrl: string;
    try {
      rpcUrl = getStellarRpcUrl();
    } catch (err) {
      throw AppError.internal(
        err instanceof Error
          ? err.message
          : "Invalid Stellar RPC configuration",
      );
    }

    try {
      await this.getRpcServer().getHealth();
    } catch (err) {
      throw AppError.internal(
        `Stellar RPC is unreachable at ${rpcUrl}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    logger.info("Soroban configuration validated", {
      loanManagerContractId: process.env.LOAN_MANAGER_CONTRACT_ID,
      lendingPoolContractId: process.env.LENDING_POOL_CONTRACT_ID,
      rpcUrl,
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
      ...(resultXdr ? { resultXdr } : {}),
    };
  }

  /**
   * Reads the authoritative borrower score from the Remittance NFT contract.
   * Uses a lightweight simulation because `get_score` is a read-only call.
   */
  async getOnChainCreditScore(userPublicKey: string): Promise<number> {
    const server = this.getRpcServer();
    const contractId = this.getRemittanceNftContractId();
    const passphrase = this.getNetworkPassphrase();
    const source = this.getScoreReadSourceKeypair();

    const account = await server.getAccount(source.publicKey());
    const userScVal = nativeToScVal(Address.fromString(userPublicKey), {
      type: "address",
    });

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: passphrase,
    })
      .addOperation(
        Operation.invokeContractFunction({
          contract: contractId,
          function: "get_score",
          args: [userScVal],
        }),
      )
      .setTimeout(30)
      .build();

    const simulation = await server.simulateTransaction(tx);
    if ("error" in simulation) {
      throw AppError.internal(
        `Failed to simulate get_score for ${userPublicKey}: ${simulation.error}`,
      );
    }

    const retval = simulation.result?.retval;
    if (!retval) {
      throw AppError.internal(
        `No score returned by get_score for ${userPublicKey}`,
      );
    }

    const nativeScore = scValToNative(retval);
    const score = Number(nativeScore);
    if (!Number.isFinite(score)) {
      throw AppError.internal(
        `Invalid on-chain score returned for ${userPublicKey}`,
      );
    }

    return score;
  }

  /**
   * Ping the Stellar RPC server to verify connectivity.
   * Calls getLatestLedger() with a 5-second timeout.
   */
  async healthCheck(): Promise<{
    connected: boolean;
    latestLedger?: number;
    error?: string;
  }> {
    try {
      const server = this.getRpcServer();
      const timeoutPromise = new Promise<{ connected: boolean; error: string }>(
        (_, reject) => setTimeout(() => reject(new Error("RPC timeout")), 5000),
      );

      const ledgerPromise = server.getLatestLedger().then((res) => ({
        connected: true,
        latestLedger: res.sequence,
      }));

      return await Promise.race([ledgerPromise, timeoutPromise]);
    } catch (error) {
      return {
        connected: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Reads the current available liquidity from the pool token.
   * This calls the token's balance function for the lending pool contract.
   */
  async getPoolBalance(): Promise<number> {
    const server = this.getRpcServer();
    const tokenAddress = this.getPoolTokenAddress();
    const poolId = this.getLendingPoolContractId();
    const passphrase = this.getNetworkPassphrase();
    const source = this.getScoreReadSourceKeypair(); // Re-use read-only keypair

    const account = await server.getAccount(source.publicKey());
    const poolScVal = nativeToScVal(Address.fromString(poolId), {
      type: "address",
    });

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: passphrase,
    })
      .addOperation(
        Operation.invokeContractFunction({
          contract: tokenAddress,
          function: "balance",
          args: [poolScVal],
        }),
      )
      .setTimeout(30)
      .build();

    const simulation = await server.simulateTransaction(tx);
    if ("error" in simulation) {
      throw AppError.internal(
        `Failed to simulate pool balance: ${simulation.error}`,
      );
    }

    const retval = simulation.result?.retval;
    if (!retval) {
      throw AppError.internal("No balance returned by pool token");
    }

    const nativeBalance = scValToNative(retval);
    const balance = Number(nativeBalance);
    if (!Number.isFinite(balance)) {
      throw AppError.internal("Invalid on-chain balance returned");
    }

    return balance;
  }

  /**
   * Returns score adjustment constants for indexing.
   * Values are sourced from environment variables so they stay in sync
   * with the deployed RemittanceNFT contract constants without requiring
   * a hardcoded value in application logic.
   */
  getScoreConfig(): { repaymentDelta: number; defaultPenalty: number } {
    const repaymentDelta = Number.parseInt(
      process.env.SCORE_REPAYMENT_DELTA ?? "15",
      10,
    );
    const defaultPenalty = Number.parseInt(
      process.env.SCORE_DEFAULT_PENALTY ?? "50",
      10,
    );
    return { repaymentDelta, defaultPenalty };
  }
}

export const sorobanService = new SorobanService();
