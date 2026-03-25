# Toast Notification System

A robust toast notification system for providing live feedback on blockchain transaction progress (Pending / Success / Failed) with Stellar Expert integration.

## Features

- ✅ Automatic transaction lifecycle feedback (Pending → Success/Failed)
- ✅ Stellar Expert links for successful transactions
- ✅ Dark mode support
- ✅ Accessible and keyboard-friendly
- ✅ Customizable messages and durations
- ✅ Built with Sonner (lightweight, modern toast library)

## Installation

The toast system is already installed and configured. It uses:

- `sonner` - Toast notification library
- `lucide-react` - Icons (already in project)

## Quick Start

### 1. Automatic Toast Notifications (Recommended)

Use `useContractMutation` to wrap any mutation with automatic toast feedback:

```tsx
import { useContractMutation } from "@/app/hooks/useContractMutation";
import { useCreateLoan } from "@/app/hooks/useApi";

function MyComponent() {
  const createLoan = useContractMutation(useCreateLoan(), {
    pendingMessage: "Creating loan on blockchain...",
    successMessage: "Loan created successfully!",
    errorMessage: "Failed to create loan",
    network: "testnet", // or "public"
  });

  const handleSubmit = () => {
    createLoan.mutate({
      amount: 1000,
      currency: "USDC",
      // ... other fields
    });
  };

  return (
    <button onClick={handleSubmit} disabled={createLoan.isPending}>
      {createLoan.isPending ? "Creating..." : "Create Loan"}
    </button>
  );
}
```

### 2. Manual Toast Control

For custom logic or more control:

```tsx
import { useContractToast } from "@/app/hooks/useContractToast";
import { useCreateLoan } from "@/app/hooks/useApi";

function MyComponent() {
  const toast = useContractToast();
  const createLoan = useCreateLoan();

  const handleSubmit = async () => {
    const toastId = toast.showPending("Creating loan...");

    try {
      const result = await createLoan.mutateAsync({
        /* data */
      });

      toast.showSuccess(toastId, {
        successMessage: "Loan created!",
        txHash: result.txHash,
        network: "testnet",
      });
    } catch (error) {
      toast.showError(toastId, {
        errorMessage: error.message,
      });
    }
  };

  return <button onClick={handleSubmit}>Create Loan</button>;
}
```

### 3. Standalone Toasts

For non-transaction notifications:

```tsx
import { useContractToast } from "@/app/hooks/useContractToast";

function MyComponent() {
  const toast = useContractToast();

  return (
    <div>
      <button onClick={() => toast.success("Operation completed!")}>Success</button>
      <button onClick={() => toast.error("Something went wrong")}>Error</button>
      <button onClick={() => toast.info("FYI: New feature available")}>Info</button>
      <button onClick={() => toast.warning("Please verify your data")}>Warning</button>
    </div>
  );
}
```

## API Reference

### `useContractMutation(mutation, options)`

Wraps a TanStack Query mutation with automatic toast notifications.

**Parameters:**

- `mutation`: TanStack Query mutation result (from `useCreateLoan`, etc.)
- `options`: Configuration object
  - `pendingMessage?: string` - Message during pending state
  - `successMessage?: string` - Message on success
  - `errorMessage?: string` - Message on error
  - `network?: "testnet" | "public"` - Stellar network for explorer links
  - `disableToast?: boolean` - Disable automatic toasts

**Returns:** Enhanced mutation with automatic toast notifications

### `useContractToast()`

Hook providing toast notification methods.

**Methods:**

#### Transaction Lifecycle

- `showPending(message)` - Show pending toast, returns toast ID
- `showSuccess(toastId, options)` - Update to success with optional Stellar Expert link
- `showError(toastId, options)` - Update to error state

#### Standalone Toasts

- `success(message, options)` - Show success toast
- `error(message, description?)` - Show error toast
- `info(message, description?)` - Show info toast
- `warning(message, description?)` - Show warning toast

#### Utilities

- `getStellarExpertUrl(txHash, network)` - Generate Stellar Expert URL

## Stellar Expert Integration

When a transaction succeeds and includes a `txHash`, the toast automatically displays a "View on Explorer" button that opens the transaction in Stellar Expert.

**Supported Networks:**

- `testnet` - https://stellar.expert/explorer/testnet
- `public` - https://stellar.expert/explorer/public

## Backend Integration

For the toast system to work with transaction hashes, your backend API should return a `txHash` field in successful responses:

```typescript
// Backend response example
{
  "id": "loan-123",
  "amount": 1000,
  "status": "active",
  "txHash": "abc123def456..." // Include this for Stellar Expert links
}
```

## Customization

### Toast Appearance

Toasts are styled in `frontend/src/app/components/ui/Toast.tsx`. Customize colors, borders, and spacing by modifying the `toastOptions.classNames` object.

### Default Duration

Default durations:

- Pending: Until updated
- Success: 5-6 seconds
- Error: 6 seconds
- Info: 4 seconds
- Warning: 5 seconds

Override per toast:

```tsx
toast.success("Message", { duration: 10000 }); // 10 seconds
```

## Examples

See `frontend/src/app/components/examples/LoanFormExample.tsx` for a complete working example demonstrating both automatic and manual approaches.

## Testing

Test different toast states:

```tsx
// Success with transaction link
toast.success("Transaction complete!", {
  txHash: "abc123",
  network: "testnet",
});

// Error
toast.error("Transaction failed", "Please try again");

// Info
toast.info("New feature available", "Check out the dashboard");

// Warning
toast.warning("Low balance", "Consider adding funds");
```

## Troubleshooting

**Toast not appearing:**

- Ensure `<Toaster />` is included in your layout (already done in `app/layout.tsx`)
- Check browser console for errors

**Stellar Expert link not working:**

- Verify `txHash` is included in API response
- Confirm `network` parameter is correct ("testnet" or "public")

**Toast styling issues:**

- Check dark mode is working correctly
- Verify Tailwind classes are not being purged

## Best Practices

1. **Use automatic toasts** (`useContractMutation`) for standard CRUD operations
2. **Use manual toasts** when you need custom logic or conditional messaging
3. **Always include txHash** in backend responses for blockchain transactions
4. **Keep messages concise** - Users should understand at a glance
5. **Use appropriate variants** - success for completions, error for failures, info for FYI, warning for caution
6. **Test both light and dark modes** - Ensure readability in both themes

## Migration from Old Toast System

If you were using the Zustand-based toast system (`useUIStore`):

**Before:**

```tsx
const { addToast } = useUIStore();
addToast({ message: "Success!", variant: "success", duration: 4000 });
```

**After:**

```tsx
const toast = useContractToast();
toast.success("Success!");
```

The old system is still available but the new Sonner-based system is recommended for better UX and features.
