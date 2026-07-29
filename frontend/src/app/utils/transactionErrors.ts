export type TransactionErrorCategory =
  | "wallet_rejected"
  | "network_timeout"
  | "insufficient_balance"
  | "score_too_low"
  | "onchain_failure"
  | "simulation_failed"
  | "unknown";

export interface TransactionErrorDetails {
  category: TransactionErrorCategory;
  title: string;
  message: string;
  guidance: string;
  retryable: boolean;
  cancelledByUser: boolean;
}

export interface PollTransactionOptions {
  horizonUrl?: string;
  intervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface PollTransactionResult {
  status: "success" | "failed" | "timeout" | "cancelled";
  message: string;
}

const DEFAULT_HORIZON_URL = "https://horizon-testnet.stellar.org";

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown transaction error";
  }
}

export function mapTransactionError(error: unknown): TransactionErrorDetails {
  const rawMessage = toErrorMessage(error);
  const normalized = rawMessage.toLowerCase();

  if (
    normalized.includes("rejected") ||
    normalized.includes("denied") ||
    normalized.includes("cancelled") ||
    normalized.includes("canceled")
  ) {
    return {
      category: "wallet_rejected",
      title: "Transaction cancelled",
      message: "You cancelled the signing request in your wallet.",
      guidance: "No funds moved. You can review details and submit again when ready.",
      retryable: true,
      cancelledByUser: true,
    };
  }

  if (
    normalized.includes("timeout") ||
    normalized.includes("network") ||
    normalized.includes("failed to fetch")
  ) {
    return {
      category: "network_timeout",
      title: "Network issue",
      message: "The network request timed out or could not be completed.",
      guidance: "Check connectivity and retry. If it keeps failing, try again in a few minutes.",
      retryable: true,
      cancelledByUser: false,
    };
  }

  if (
    normalized.includes("insufficient") &&
    (normalized.includes("balance") || normalized.includes("fund"))
  ) {
    return {
      category: "insufficient_balance",
      title: "Insufficient balance",
      message: "Your available balance is too low for this transaction.",
      guidance: "Reduce the amount or fund your wallet, then try again.",
      retryable: false,
      cancelledByUser: false,
    };
  }

  if (
    normalized.includes("score too low") ||
    normalized.includes("insufficient score") ||
    normalized.includes("insufficientscore")
  ) {
    return {
      category: "score_too_low",
      title: "Loan request not eligible",
      message: "Your credit score does not meet the minimum requirement.",
      guidance: "Repay active loans on time and retry after your score improves.",
      retryable: false,
      cancelledByUser: false,
    };
  }

  if (normalized.includes("simulation") || normalized.includes("host error")) {
    return {
      category: "simulation_failed",
      title: "Simulation failed",
      message: "The contract simulation failed before submission.",
      guidance: "Review your values and wallet state, then retry.",
      retryable: true,
      cancelledByUser: false,
    };
  }

  if (
    normalized.includes("failed on-chain") ||
    normalized.includes("tx failed") ||
    normalized.includes("revert")
  ) {
    return {
      category: "onchain_failure",
      title: "Transaction failed on-chain",
      message: "The transaction was submitted but did not succeed on-chain.",
      guidance: "Check the transaction hash details and adjust inputs before retrying.",
      retryable: false,
      cancelledByUser: false,
    };
  }

  return {
    category: "unknown",
    title: "Transaction failed",
    message: rawMessage,
    guidance: "Try again, or adjust the amount and wallet state before retrying.",
    retryable: true,
    cancelledByUser: false,
  };
}

async function fetchTransactionStatus(
  txHash: string,
  horizonUrl: string,
): Promise<"pending" | "success" | "failed"> {
  const response = await fetch(`${horizonUrl}/transactions/${txHash}`);

  if (response.status === 404) {
    return "pending";
  }

  if (!response.ok) {
    throw new Error(`Unable to fetch transaction status (${response.status})`);
  }

  const payload = (await response.json()) as { successful?: boolean };
  return payload.successful ? "success" : "failed";
}

export async function pollTransactionStatus(
  txHash: string,
  {
    horizonUrl = process.env.NEXT_PUBLIC_HORIZON_URL ?? DEFAULT_HORIZON_URL,
    intervalMs = 2500,
    timeoutMs = 30_000,
    signal,
  }: PollTransactionOptions = {},
): Promise<PollTransactionResult> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (signal?.aborted) {
      return {
        status: "cancelled",
        message: "Status tracking cancelled by user.",
      };
    }

    const status = await fetchTransactionStatus(txHash, horizonUrl);

    if (status === "success") {
      return { status: "success", message: "Transaction confirmed on-chain." };
    }

    if (status === "failed") {
      return { status: "failed", message: "Transaction failed on-chain." };
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return {
    status: "timeout",
    message: "Transaction is still pending. You can retry status tracking.",
  };
}
