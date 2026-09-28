import React from "react";
import { render, screen, fireEvent, renderHook, act } from "@testing-library/react";
import { useConfirmedMutation } from "./useConfirmedMutation";
import ConfirmTransactionDialog from "../components/ui/ConfirmTransactionDialog";
import { useToastStore } from "../stores/useToastStore";

describe("useConfirmedMutation (#1890)", () => {
  beforeEach(() => {
    useToastStore.getState().clearToasts();
    jest.clearAllMocks();
  });

  interface MutationVars {
    loanId: number;
    amount: number;
  }

  it("opens the dialog with summary when triggered", () => {
    const action = jest.fn().mockResolvedValue({ txHash: "0x123" });
    const { result } = renderHook(() =>
      useConfirmedMutation<MutationVars>(action, {
        title: "Confirm Loan Repayment",
        buildSummary: (vars) => [
          { label: "Loan ID", value: String(vars.loanId) },
          { label: "Amount", value: `${vars.amount} USDC` },
        ],
      }),
    );

    expect(result.current.dialogProps.isOpen).toBe(false);

    act(() => {
      result.current.trigger({ loanId: 101, amount: 250 });
    });

    expect(result.current.dialogProps.isOpen).toBe(true);
    expect(result.current.dialogProps.summary).toEqual([
      { label: "Loan ID", value: "101" },
      { label: "Amount", value: "250 USDC" },
    ]);
    expect(result.current.dialogProps.error).toBeNull();
  });

  it("keeps dialog open and surfaces error when action rejects (closes #1890)", async () => {
    const errorMsg = "Host error: contract transaction failed with code 4";
    const action = jest.fn().mockRejectedValue(new Error(errorMsg));
    const onError = jest.fn();

    const { result } = renderHook(() =>
      useConfirmedMutation<MutationVars>(action, {
        title: "Confirm Action",
        onError,
      }),
    );

    act(() => {
      result.current.trigger({ loanId: 101, amount: 250 });
    });

    expect(result.current.dialogProps.isOpen).toBe(true);

    // Call onConfirm and await the promise resolution within act
    await act(async () => {
      await result.current.dialogProps.onConfirm();
    });

    // The dialog must NOT silently close; it stays open with error surfaced
    expect(result.current.dialogProps.isOpen).toBe(true);
    expect(result.current.dialogProps.isLoading).toBe(false);
    expect(result.current.dialogProps.error).toBe(errorMsg);
    expect(result.current.error).toBe(errorMsg);

    // onError callback must be invoked
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(onError.mock.calls[0][0].message).toBe(errorMsg);

    // Error toast must be added to useToastStore
    const toasts = useToastStore.getState().toasts;
    expect(toasts.length).toBeGreaterThan(0);
    const errToast = toasts.find((t) => t.type === "error");
    expect(errToast).toBeDefined();
    expect(errToast?.title).toBe("Action Failed");
    expect(errToast?.description).toBe(errorMsg);
  });

  it("handles non-Error rejection without unhandled rejection", async () => {
    const action = jest.fn().mockRejectedValue("String failure reason");

    const { result } = renderHook(() => useConfirmedMutation<MutationVars>(action));

    act(() => {
      result.current.trigger({ loanId: 102, amount: 50 });
    });

    await act(async () => {
      await result.current.dialogProps.onConfirm();
    });

    expect(result.current.dialogProps.isOpen).toBe(true);
    expect(result.current.dialogProps.error).toBe("String failure reason");
  });

  it("allows successful retry after a rejection and closes dialog", async () => {
    let callCount = 0;
    const action = jest.fn().mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        return Promise.reject(new Error("First attempt failed"));
      }
      return Promise.resolve({ ok: true });
    });

    const onSuccess = jest.fn();
    const { result } = renderHook(() => useConfirmedMutation<MutationVars>(action, { onSuccess }));

    act(() => {
      result.current.trigger({ loanId: 103, amount: 100 });
    });

    // Attempt 1 -> fails, stays open
    await act(async () => {
      await result.current.dialogProps.onConfirm();
    });
    expect(result.current.dialogProps.isOpen).toBe(true);
    expect(result.current.dialogProps.error).toBe("First attempt failed");
    expect(onSuccess).not.toHaveBeenCalled();

    // Attempt 2 (Retry) -> succeeds, closes
    await act(async () => {
      await result.current.dialogProps.onConfirm();
    });
    expect(result.current.dialogProps.isOpen).toBe(false);
    expect(result.current.dialogProps.error).toBeNull();
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("resets state when closed via onClose", () => {
    const action = jest.fn().mockResolvedValue(true);
    const { result } = renderHook(() => useConfirmedMutation<MutationVars>(action));

    act(() => {
      result.current.trigger({ loanId: 104, amount: 500 });
    });
    expect(result.current.dialogProps.isOpen).toBe(true);

    act(() => {
      result.current.dialogProps.onClose();
    });
    expect(result.current.dialogProps.isOpen).toBe(false);
  });

  it("renders error banner in ConfirmTransactionDialog component when error is set", () => {
    const onClose = jest.fn();
    const onConfirm = jest.fn();

    render(
      <ConfirmTransactionDialog
        isOpen={true}
        onClose={onClose}
        onConfirm={onConfirm}
        title="Confirm Test"
        error="Transaction rejected by user wallet"
        summary={[{ label: "Recipient", value: "GAB..." }]}
      />,
    );

    const alertBanner = screen.getByRole("alert");
    expect(alertBanner).toBeInTheDocument();
    expect(screen.getByText("Transaction rejected by user wallet")).toBeInTheDocument();
  });
});
