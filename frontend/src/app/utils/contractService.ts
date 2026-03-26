/**
 * utils/contractService.ts
 *
 * Soroban contract interaction utilities for the frontend.
 * Builds, simulates, signs (via Freighter), and submits transactions.
 *
 * Required peer dependencies (not bundled with the frontend by default):
 *   npm install @stellar/stellar-sdk @stellar/freighter-api
 *
 * Environment variables:
 *   NEXT_PUBLIC_MANAGER_CONTRACT_ID   — deployed LoanManager contract address
 *   NEXT_PUBLIC_SOROBAN_RPC_URL       — Soroban RPC endpoint (defaults to testnet)
 *   NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE — network passphrase (defaults to testnet)
 */

const LOAN_MANAGER_CONTRACT_ID = process.env.NEXT_PUBLIC_MANAGER_CONTRACT_ID ?? "";
const SOROBAN_RPC_URL =
  process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";
const STELLAR_NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";

// Stellar token amounts use 7 decimal places.
// 1 USDC (or any SEP-0041 token) = 10_000_000 stroops.
const TOKEN_SCALE = 10_000_000n;

function toStroops(humanAmount: number): bigint {
  return BigInt(Math.round(humanAmount * Number(TOKEN_SCALE)));
}

// Poll interval and max attempts for transaction confirmation
const POLL_INTERVAL_MS = 2_000;
const MAX_POLL_ATTEMPTS = 30; // 60 seconds total

/**
 * Builds, signs via Freighter, submits, and polls a `repay` transaction.
 *
 * Corresponds to the loan_manager contract function:
 *   repay(borrower: Address, loan_id: u32, amount: i128)
 *
 * @param borrowerAddress  Connected wallet's Stellar address
 * @param loanId           On-chain loan ID (u32)
 * @param amount           Human-readable amount (e.g. 100.0 for 100 USDC)
 * @returns                Confirmed transaction hash
 */
export async function executeRepayTransaction(
  borrowerAddress: string,
  loanId: number,
  amount: number,
): Promise<string> {
  if (!LOAN_MANAGER_CONTRACT_ID) {
    throw new Error(
      "NEXT_PUBLIC_MANAGER_CONTRACT_ID is not set. Run the deploy script first.",
    );
  }

  // Dynamic imports keep these heavy packages out of the initial bundle
  // and prevent crashes during SSR (these APIs only work in the browser).
  const [sdk, freighterApi] = await Promise.all([
    import("@stellar/stellar-sdk"),
    import("@stellar/freighter-api"),
  ]);

  const { Contract, TransactionBuilder, BASE_FEE, nativeToScVal, rpc } = sdk;
  const server = new rpc.Server(SOROBAN_RPC_URL);

  // Load the account's current sequence number from the network.
  const account = await server.getAccount(borrowerAddress).catch(() => {
    throw new Error(
      `Account ${borrowerAddress.slice(0, 8)}... not found on network. Ensure it is funded.`,
    );
  });

  const contract = new Contract(LOAN_MANAGER_CONTRACT_ID);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        "repay",
        // The contract's `repay` expects auth from the borrower, so the borrower
        // address is passed as the first argument and must be the signer.
        nativeToScVal(borrowerAddress, { type: "address" }),
        nativeToScVal(loanId, { type: "u32" }),
        nativeToScVal(toStroops(amount), { type: "i128" }),
      ),
    )
    .setTimeout(30)
    .build();

  // Simulate to obtain the correct resource fee and populate auth entries.
  // This also validates that the transaction will succeed before asking the
  // user to sign it.
  const simResult = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(simResult)) {
    throw new Error(`Transaction simulation failed: ${simResult.error}`);
  }

  // Assemble: merges the simulation's footprint and fee into the transaction.
  const assembled = rpc.assembleTransaction(tx, simResult).build();
  const unsignedXDR = assembled.toXDR();

  // Sign with Freighter browser extension.
  // Freighter v3 returns a string; v4+ returns { signedXDR: string }.
  const signResult = await freighterApi.signTransaction(unsignedXDR, {
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
  });
  const signedXDR =
    typeof signResult === "string"
      ? signResult
      : (signResult as { signedXDR: string }).signedXDR;

  if (!signedXDR) {
    throw new Error("Wallet returned an empty signed transaction. Did you cancel?");
  }

  // Submit the signed transaction to the network.
  const signedTx = TransactionBuilder.fromXDR(signedXDR, STELLAR_NETWORK_PASSPHRASE);
  const sendResponse = await server.sendTransaction(signedTx);

  if (sendResponse.status === "ERROR") {
    const resultCode =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (sendResponse as any).errorResult?.result?.switch?.()?.name ?? "Unknown";
    throw new Error(`Transaction submission failed (${resultCode})`);
  }

  // Poll until the transaction is finalized (SUCCESS or FAILED).
  const txHash = sendResponse.hash;
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    const result = await server.getTransaction(txHash);
    if (result.status === "FAILED") {
      throw new Error("Transaction was rejected on-chain. The loan may no longer be active.");
    }
    if (result.status === "SUCCESS") {
      return txHash;
    }
    // status === "NOT_FOUND" means still pending — keep polling
  }

  throw new Error(
    `Transaction confirmation timed out after ${(MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS) / 1000}s. ` +
      `Check the Stellar Explorer for hash: ${txHash}`,
  );
}
