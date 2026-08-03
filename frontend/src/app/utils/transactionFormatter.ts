/**
 * utils/transactionFormatter.ts
 *
 * Utility functions for formatting transaction data into human-readable descriptions.
 * Converts contract calls and blockchain operations into clear, user-friendly text.
 */

import type {
  TransactionOperation,
  BalanceChange,
  TransactionPreviewData,
} from "../components/transaction/TransactionPreviewModal";

// ─── Transaction Type Formatters ─────────────────────────────────────────────

export interface LoanRequestParams {
  amount: number;
  borrower: string;
}

export interface LoanRepaymentParams {
  loanId: number;
  amount: number;
}

export interface DepositParams {
  amount: number;
  token: string;
}

export interface WithdrawParams {
  amount: number;
  token: string;
}

/**
 * Format a loan request transaction
 */
export function formatLoanRequest(params: LoanRequestParams): TransactionPreviewData {
  const operations: TransactionOperation[] = [
    {
      type: "Request Loan",
      description: `You are requesting a loan of ${params.amount} USDC`,
      amount: params.amount.toString(),
      token: "USDC",
      details: {
        "Borrower Address": `${params.borrower.slice(0, 8)}...${params.borrower.slice(-6)}`,
        "Loan Status": "Pending Approval",
      },
    },
  ];

  const balanceChanges: BalanceChange[] = [
    {
      token: "USDC",
      change: `${params.amount}`,
      isPositive: true,
    },
  ];

  return {
    operations,
    balanceChanges,
    estimatedGasFee: "0.00001",
    network: "Stellar Testnet",
  };
}

/**
 * Format a loan repayment transaction
 */
export function formatLoanRepayment(params: LoanRepaymentParams): TransactionPreviewData {
  const operations: TransactionOperation[] = [
    {
      type: "Repay Loan",
      description: `You are repaying ${params.amount} USDC for Loan #${params.loanId}`,
      amount: params.amount.toString(),
      token: "USDC",
      details: {
        "Loan ID": params.loanId.toString(),
        "Payment Type": "Principal + Interest",
      },
    },
  ];

  const balanceChanges: BalanceChange[] = [
    {
      token: "USDC",
      change: `-${params.amount}`,
      isPositive: false,
    },
  ];

  return {
    operations,
    balanceChanges,
    estimatedGasFee: "0.00001",
    network: "Stellar Testnet",
  };
}

/**
 * Format a deposit transaction
 */
export function formatDeposit(params: DepositParams): TransactionPreviewData {
  const operations: TransactionOperation[] = [
    {
      type: "Deposit",
      description: `You are depositing ${params.amount} ${params.token} into the lending pool`,
      amount: params.amount.toString(),
      token: params.token,
      details: {
        "Pool Type": "Lending Pool",
        "Expected Yield": "~8-12% APY",
      },
    },
  ];

  const balanceChanges: BalanceChange[] = [
    {
      token: params.token,
      change: `-${params.amount}`,
      isPositive: false,
    },
    {
      token: `LP-${params.token}`,
      change: `${params.amount}`,
      isPositive: true,
    },
  ];

  return {
    operations,
    balanceChanges,
    estimatedGasFee: "0.00001",
    network: "Stellar Testnet",
  };
}

/**
 * Format a withdrawal transaction
 */
export function formatWithdraw(params: WithdrawParams): TransactionPreviewData {
  const operations: TransactionOperation[] = [
    {
      type: "Withdraw",
      description: `You are withdrawing ${params.amount} ${params.token} from the lending pool`,
      amount: params.amount.toString(),
      token: params.token,
      details: {
        "Pool Type": "Lending Pool",
        "Withdrawal Type": "Full Amount + Earned Interest",
      },
    },
  ];

  const balanceChanges: BalanceChange[] = [
    {
      token: `LP-${params.token}`,
      change: `-${params.amount}`,
      isPositive: false,
    },
    {
      token: params.token,
      change: `${params.amount}`,
      isPositive: true,
    },
  ];

  return {
    operations,
    balanceChanges,
    estimatedGasFee: "0.00001",
    network: "Stellar Testnet",
  };
}

/**
 * Format a remittance send transaction
 */
export function formatRemittanceSend(params: {
  amount: number;
  recipient: string;
  token: string;
}): TransactionPreviewData {
  const operations: TransactionOperation[] = [
    {
      type: "Send Remittance",
      description: `You are sending ${params.amount} ${params.token} to ${params.recipient.slice(0, 8)}...${params.recipient.slice(-6)}`,
      amount: params.amount.toString(),
      token: params.token,
      details: {
        Recipient: `${params.recipient.slice(0, 8)}...${params.recipient.slice(-6)}`,
        "Transfer Type": "Cross-border Remittance",
        "Credit Score Impact": "+5 points",
      },
    },
  ];

  const balanceChanges: BalanceChange[] = [
    {
      token: params.token,
      change: `-${params.amount}`,
      isPositive: false,
    },
  ];

  return {
    operations,
    balanceChanges,
    estimatedGasFee: "0.00001",
    network: "Stellar Testnet",
  };
}

/**
 * Format a generic contract interaction
 */
export function formatGenericTransaction(params: {
  contractMethod: string;
  description: string;
  args?: Record<string, string | number>;
}): TransactionPreviewData {
  const operations: TransactionOperation[] = [
    {
      type: params.contractMethod,
      description: params.description,
      details: params.args,
    },
  ];

  return {
    operations,
    balanceChanges: [],
    estimatedGasFee: "0.00001",
    network: "Stellar Testnet",
  };
}
