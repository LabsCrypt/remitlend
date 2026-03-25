# Transaction Preview Modal

A comprehensive transaction preview system that shows users exactly what they're signing before executing blockchain transactions.

## Overview

The Transaction Preview Modal provides a clear, human-readable interface for reviewing transaction details before signing. It includes:

- **Human-readable operation descriptions** - Clear explanations of what each transaction does
- **Balance change predictions** - Shows expected changes to wallet balances
- **Gas fee estimation** - Displays estimated network fees
- **Safety disclaimers** - Important warnings about transaction irreversibility
- **Acknowledgment requirement** - Users must confirm understanding before proceeding

## Components

### TransactionPreviewModal

The main modal component that displays transaction details.

```tsx
import { TransactionPreviewModal } from "@/components/transaction/TransactionPreviewModal";

<TransactionPreviewModal
  isOpen={isOpen}
  onClose={handleClose}
  onConfirm={handleConfirm}
  data={transactionData}
  isLoading={isProcessing}
/>;
```

**Props:**

- `isOpen` (boolean) - Controls modal visibility
- `onClose` (function) - Called when user cancels or closes modal
- `onConfirm` (function) - Called when user confirms transaction
- `data` (TransactionPreviewData) - Transaction details to display
- `isLoading` (boolean, optional) - Shows loading state during transaction execution

### useTransactionPreview Hook

A custom hook for managing transaction preview state.

```tsx
import { useTransactionPreview } from "@/hooks/useTransactionPreview";

function MyComponent() {
  const txPreview = useTransactionPreview();

  const handleTransaction = () => {
    txPreview.show(transactionData, async () => {
      // Execute transaction
      await executeTransaction();
    });
  };

  return (
    <>
      <button onClick={handleTransaction}>Execute</button>

      {txPreview.data && (
        <TransactionPreviewModal
          isOpen={txPreview.isOpen}
          onClose={txPreview.close}
          onConfirm={txPreview.confirm}
          data={txPreview.data}
          isLoading={txPreview.isLoading}
        />
      )}
    </>
  );
}
```

## Transaction Formatters

Utility functions to convert transaction parameters into preview data.

### Available Formatters

```tsx
import {
  formatLoanRequest,
  formatLoanRepayment,
  formatDeposit,
  formatWithdraw,
  formatRemittanceSend,
  formatGenericTransaction,
} from "@/utils/transactionFormatter";

// Loan request
const loanData = formatLoanRequest({
  amount: 1000,
  borrower: "GCKFBEIYV2U22IO2BJ4KVJOIP7XPWQGQFKKWXR6DOSJBV7STMAQSMEK4",
});

// Loan repayment
const repayData = formatLoanRepayment({
  loanId: 123,
  amount: 500,
});

// Deposit to lending pool
const depositData = formatDeposit({
  amount: 2000,
  token: "USDC",
});

// Withdraw from lending pool
const withdrawData = formatWithdraw({
  amount: 1500,
  token: "USDC",
});

// Send remittance
const remittanceData = formatRemittanceSend({
  amount: 300,
  recipient: "GDQWI6FKB72DPOJE4CGYCFQZKRPQQIOYXRMZ5KEVGXMG6UUTGJMBCASH",
  token: "USDC",
});

// Generic transaction
const genericData = formatGenericTransaction({
  contractMethod: "approve_loan",
  description: "You are approving a loan request",
  args: {
    "Loan ID": "456",
    "Approval Amount": "1000 USDC",
  },
});
```

## Data Types

### TransactionPreviewData

```typescript
interface TransactionPreviewData {
  operations: TransactionOperation[];
  balanceChanges: BalanceChange[];
  estimatedGasFee?: string;
  network: string;
  contractAddress?: string;
}
```

### TransactionOperation

```typescript
interface TransactionOperation {
  type: string; // e.g., "Deposit", "Repay Loan"
  description: string; // Human-readable description
  amount?: string; // Transaction amount
  token?: string; // Token symbol
  from?: string; // Sender address
  to?: string; // Recipient address
  details?: Record<string, string | number>; // Additional details
}
```

### BalanceChange

```typescript
interface BalanceChange {
  token: string; // Token symbol
  change: string; // Amount change (with sign)
  isPositive: boolean; // Whether it's an increase
}
```

## Integration Examples

### Example 1: Loan Repayment Form

```tsx
import { useState } from "react";
import { useTransactionPreview } from "@/hooks/useTransactionPreview";
import { formatLoanRepayment } from "@/utils/transactionFormatter";
import { TransactionPreviewModal } from "@/components/transaction/TransactionPreviewModal";

function LoanRepaymentForm({ loanId, totalOwed }) {
  const [amount, setAmount] = useState("");
  const txPreview = useTransactionPreview();

  const handleRepay = () => {
    const data = formatLoanRepayment({
      loanId,
      amount: parseFloat(amount),
    });

    txPreview.show(data, async () => {
      // Call smart contract
      await repayLoan(loanId, amount);
    });
  };

  return (
    <>
      <input
        type="number"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="Amount to repay"
      />
      <button onClick={handleRepay}>Repay</button>

      {txPreview.data && (
        <TransactionPreviewModal
          isOpen={txPreview.isOpen}
          onClose={txPreview.close}
          onConfirm={txPreview.confirm}
          data={txPreview.data}
          isLoading={txPreview.isLoading}
        />
      )}
    </>
  );
}
```

### Example 2: With useContractMutation

```tsx
import { useContractMutation } from "@/hooks/useContractMutation";
import { useTransactionPreview } from "@/hooks/useTransactionPreview";
import { formatDeposit } from "@/utils/transactionFormatter";

function DepositForm() {
  const [amount, setAmount] = useState("");
  const txPreview = useTransactionPreview();

  const depositMutation = useContractMutation(useDeposit(), {
    successMessage: "Deposit successful!",
    errorMessage: "Deposit failed",
  });

  const handleDeposit = () => {
    const data = formatDeposit({
      amount: parseFloat(amount),
      token: "USDC",
    });

    txPreview.show(data, async () => {
      await depositMutation.mutateAsync({ amount });
    });
  };

  return (
    <>
      <input
        type="number"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <button onClick={handleDeposit}>Deposit</button>

      {txPreview.data && (
        <TransactionPreviewModal
          isOpen={txPreview.isOpen}
          onClose={txPreview.close}
          onConfirm={txPreview.confirm}
          data={txPreview.data}
          isLoading={txPreview.isLoading}
        />
      )}
    </>
  );
}
```

## Styling

The component uses Tailwind CSS and supports dark mode out of the box. It follows the existing design system with:

- Consistent color scheme (blue for info, amber for warnings, red for errors)
- Responsive design (mobile-first approach)
- Smooth animations and transitions
- Accessible focus states and keyboard navigation

## Accessibility

- Keyboard navigation (Escape to close)
- Focus management
- ARIA labels where appropriate
- Clear visual hierarchy
- High contrast colors

## Best Practices

1. **Always show preview for financial transactions** - Users should never be surprised by what they're signing
2. **Provide accurate gas estimates** - Update estimates based on current network conditions
3. **Use clear, non-technical language** - Avoid jargon in operation descriptions
4. **Show all balance changes** - Include both positive and negative changes
5. **Require acknowledgment** - Force users to confirm they understand the transaction
6. **Handle errors gracefully** - Keep modal open on error so users can retry

## Testing

Visit `/transaction-preview-demo` (development only) to see interactive examples of all transaction types.

## Future Enhancements

- [ ] Real-time gas fee estimation from Stellar network
- [ ] Multi-operation transaction support
- [ ] Transaction simulation/dry-run before signing
- [ ] Historical transaction comparison
- [ ] Risk scoring for transactions
- [ ] Multi-language support
