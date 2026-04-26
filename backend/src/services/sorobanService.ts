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
  private static readonly FALLBACK_CREDIT_SCORE = 500;
  private static readonly SCORE_SIMULATION_RETRY_ATTEMPTS = 2;

  private getRpcServer() {
    return createSorobanRpcServer();
  }

  private scoreConfig: { repaymentDelta: number; defaultPenalty: number } | null =
    null;
  private lastScoreConfigFetch = 0;
  private readonly SCORE_CONFIG_TTL_MS = 60 * 60 * 1000; // 1 hour

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

  private getDefaultCreditScore(): number {
    const configured = Number.parseInt(
      process.env.DEFAULT_CREDIT_SCORE ??
        String(SorobanService.FALLBACK_CREDIT_SCORE),
      10,
    );

    if (!Number.isFinite(configured)) {
      return SorobanService.FALLBACK_CREDIT_SCORE;
    }

    return configured;
  }

  private isMissingScoreError(message: string): boolean {
    const lower = message.toLowerCase();
    return (
      lower.includes("not found") ||
      lower.includes("unknown address") ||
      lower.includes("missing value") ||
      lower.includes("does not exist") ||
      lower.includes("contract, #") ||
      lower.includes("hosterror")
    );
  }

  private isTransientRpcError(message: string): boolean {
    const lower = message.toLowerCase();
    return (
      lower.includes("timeout") ||
      lower.includes("temporar") ||
      lower.includes("connection") ||
      lower.includes("network") ||
      lower.includes("unavailable") ||
      lower.includes("503") ||
      lower.includes("502")
    );
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

    const defaultScore = this.getDefaultCreditScore();
    let simulation: Awaited<ReturnType<typeof server.simulateTransaction>> | null =
      null;

    for (
      let attempt = 1;
      attempt <= SorobanService.SCORE_SIMULATION_RETRY_ATTEMPTS;
      attempt += 1
    ) {
      simulation = await server.simulateTransaction(tx);
      if (!("error" in simulation)) {
        break;
      }

      const message = String(simulation.error ?? "");
      const isRetryable = this.isTransientRpcError(message);
      const hasMoreAttempts =
        attempt < SorobanService.SCORE_SIMULATION_RETRY_ATTEMPTS;
      if (!isRetryable || !hasMoreAttempts) {
        break;
      }

      logger.warn("Retrying get_score simulation after transient RPC failure", {
        borrower: userPublicKey,
        attempt,
        error: message,
      });
    }

    if (!simulation) {
      logger.warn("Falling back to default credit score: empty simulation", {
        borrower: userPublicKey,
        defaultScore,
      });
      return defaultScore;
    }

    if ("error" in simulation) {
      const message = String(simulation.error ?? "");
      if (
        this.isMissingScoreError(message) ||
        this.isTransientRpcError(message)
      ) {
        logger.warn("Falling back to default credit score", {
          borrower: userPublicKey,
          defaultScore,
          reason: message,
        });
        return defaultScore;
      }

      throw AppError.internal(
        `Failed to simulate get_score for ${userPublicKey}: ${message}`,
      );
    }

    const retval = simulation.result?.retval;
    if (!retval) {
      logger.warn("Falling back to default credit score: no score returned", {
        borrower: userPublicKey,
        defaultScore,
      });
      return defaultScore;
    }

    const nativeScore = scValToNative(retval);
    const score = Number(nativeScore);
    if (!Number.isFinite(score)) {
      logger.warn("Falling back to default credit score: invalid score value", {
        borrower: userPublicKey,
        defaultScore,
        nativeScore,
      });
      return defaultScore;
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

      return await Promise.race([ledgerPromise, (timeoutPromise as Promise<any>)]);
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
   * Attempts to read them from the contract first, falling back to
   * environment variables with hardcoded defaults.
   * Results are cached for 1 hour to avoid excessive RPC load.
   */
  async getScoreConfig(): Promise<{
    repaymentDelta: number;
    defaultPenalty: number;
  }> {
    const now = Date.now();
    if (
      this.scoreConfig &&
      now - this.lastScoreConfigFetch < this.SCORE_CONFIG_TTL_MS
    ) {
      return this.scoreConfig;
    }

    try {
      // Attempt to read from contract first
      const config = await this.fetchScoreConfigFromContract();
      this.scoreConfig = config;
      this.lastScoreConfigFetch = now;
      logger.info("Fetched score configuration from contract", config);
      return config;
    } catch (error) {
      logger.warn(
        "Failed to fetch score config from contract, falling back to env vars",
        { error: error instanceof Error ? error.message : String(error) },
      );

      const repaymentDelta = Number.parseInt(
        process.env.SCORE_REPAYMENT_DELTA ?? "15",
        10,
      );
      const defaultPenalty = Number.parseInt(
        process.env.SCORE_DEFAULT_PENALTY ?? "50",
        10,
      );

      const config = { repaymentDelta, defaultPenalty };
      // Don't cache fallback values for long so we retry contract call soon
      this.scoreConfig = config;
      this.lastScoreConfigFetch = now - (this.SCORE_CONFIG_TTL_MS - 5 * 60 * 1000); // Retry in 5 mins
      return config;
    }
  }

  /**
   * Reads score configuration from the Remittance NFT contract.
   * Assumes the contract has a `get_score_config` method.
   */
  private async fetchScoreConfigFromContract(): Promise<{
    repaymentDelta: number;
    defaultPenalty: number;
  }> {
    const server = this.getRpcServer();
    const contractId = this.getRemittanceNftContractId();
    const passphrase = this.getNetworkPassphrase();
    const source = this.getScoreReadSourceKeypair();

    const account = await server.getAccount(source.publicKey());

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: passphrase,
    })
      .addOperation(
        Operation.invokeContractFunction({
          contract: contractId,
          function: "get_score_config",
          args: [],
        }),
      )
      .setTimeout(30)
      .build();

    const simulation = await server.simulateTransaction(tx);
    if ("error" in simulation) {
      throw new Error(`Simulation failed: ${simulation.error}`);
    }

    const retval = simulation.result?.retval;
    if (!retval) {
      throw new Error("No return value from get_score_config");
    }

    const native = scValToNative(retval);
    if (
      typeof native !== "object" ||
      native === null ||
      !("repayment_delta" in native) ||
      !("default_penalty" in native)
    ) {
      throw new Error("Invalid score config format returned by contract");
    }

    return {
      repaymentDelta: Number(native.repayment_delta),
      defaultPenalty: Number(native.default_penalty),
    };
  }
}

export const sorobanService = new SorobanService();
