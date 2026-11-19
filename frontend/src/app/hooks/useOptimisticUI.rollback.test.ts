/**
 * Tests for #2121: Cover frontend optimistic rollback conflicts and concurrent mutations
 *
 * Verifies useOptimisticUI store and useTransaction hook covering:
 * - Concurrent mutations & independent lifecycle state tracking
 * - Rollback ordering & conflicting mutations on identical resources
 * - Deterministic success, failure, boundary, and authorization paths
 * - Public API behavior and error contract enforcement
 */

import { act, renderHook } from "@testing-library/react";
import { useOptimisticUI, useTransaction } from "./useOptimisticUI";

describe("useOptimisticUI - Concurrent Mutations and Rollback Conflicts (#2121)", () => {
  beforeEach(() => {
    act(() => {
      useOptimisticUI.getState().clearAllTransactions();
      const state = useOptimisticUI.getState();
      state.optimisticUpdates.forEach((key) => {
        state.removeOptimisticUpdate(key);
      });
    });
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // =========================================================================
  // 1. Concurrent Mutations & Independent State Isolation
  // =========================================================================
  describe("Concurrent Mutations", () => {
    it("manages multiple concurrent transactions with independent lifecycles without crosstalk", () => {
      const store = useOptimisticUI.getState();

      act(() => {
        store.startTransaction("tx-loan-repay", "Repaying loan 1");
        store.startTransaction("tx-pool-deposit", "Depositing 500 USDC");
        store.startTransaction("tx-pool-withdraw", "Withdrawing 200 USDC");
      });

      const tx1 = store.getTransaction("tx-loan-repay");
      const tx2 = store.getTransaction("tx-pool-deposit");
      const tx3 = store.getTransaction("tx-pool-withdraw");

      expect(tx1?.status).toBe("pending");
      expect(tx2?.status).toBe("pending");
      expect(tx3?.status).toBe("pending");
      expect(tx1?.message).toBe("Repaying loan 1");
      expect(tx2?.message).toBe("Depositing 500 USDC");
      expect(tx3?.message).toBe("Withdrawing 200 USDC");

      // Advance tx1 to signing, tx2 to submitted, tx3 fails
      act(() => {
        store.signTransaction("tx-loan-repay", "Waiting for Freighter approval");
        store.submitTransaction("tx-pool-deposit", "txhash-deposit-123", "Broadcasted to Stellar");
        store.failTransaction("tx-pool-withdraw", "Insufficient liquidity in pool");
      });

      const updatedTx1 = store.getTransaction("tx-loan-repay");
      const updatedTx2 = store.getTransaction("tx-pool-deposit");
      const updatedTx3 = store.getTransaction("tx-pool-withdraw");

      expect(updatedTx1?.status).toBe("signing");
      expect(updatedTx1?.progress).toBe(40);
      expect(updatedTx1?.message).toBe("Waiting for Freighter approval");

      expect(updatedTx2?.status).toBe("submitted");
      expect(updatedTx2?.progress).toBe(70);
      expect(updatedTx2?.txHash).toBe("txhash-deposit-123");

      expect(updatedTx3?.status).toBe("failed");
      expect(updatedTx3?.error).toBe("Insufficient liquidity in pool");
    });

    it("handles out-of-order resolution of concurrent transactions deterministically", () => {
      const store = useOptimisticUI.getState();

      // txA started before txB
      act(() => {
        store.startTransaction("tx-a", "First initiated mutation");
        store.startTransaction("tx-b", "Second initiated mutation");
      });

      // txB confirms before txA finishes
      act(() => {
        store.completeTransaction("tx-b", "hash-b-complete", "Confirmed on-chain");
      });

      expect(store.getTransaction("tx-b")?.status).toBe("confirmed");
      expect(store.getTransaction("tx-b")?.progress).toBe(100);
      expect(store.getTransaction("tx-a")?.status).toBe("pending");

      // Later, txA finishes
      act(() => {
        store.completeTransaction("tx-a", "hash-a-complete", "Confirmed later");
      });

      expect(store.getTransaction("tx-a")?.status).toBe("confirmed");
      expect(store.getTransaction("tx-a")?.progress).toBe(100);
      expect(store.getTransaction("tx-a")?.txHash).toBe("hash-a-complete");
    });

    it("isolates progress updates across interleaved mutations", () => {
      const store = useOptimisticUI.getState();

      act(() => {
        store.startTransaction("tx-alpha", "Alpha");
        store.startTransaction("tx-beta", "Beta");
        store.updateProgress("tx-alpha", 25, "Alpha step 1");
        store.updateProgress("tx-beta", 60, "Beta step 1");
      });

      expect(store.getTransaction("tx-alpha")?.progress).toBe(25);
      expect(store.getTransaction("tx-alpha")?.message).toBe("Alpha step 1");
      expect(store.getTransaction("tx-beta")?.progress).toBe(60);
      expect(store.getTransaction("tx-beta")?.message).toBe("Beta step 1");
    });
  });

  // =========================================================================
  // 2. Rollback Ordering & Conflicting Resource Mutations
  // =========================================================================
  describe("Rollback Ordering and Conflicts", () => {
    it("maintains separate optimistic update keys and rolls back only the failed mutation", () => {
      const store = useOptimisticUI.getState();

      act(() => {
        store.addOptimisticUpdate("loan:101:repayment");
        store.addOptimisticUpdate("pool:depositor:456");
      });

      expect(store.isOptimisticUpdate("loan:101:repayment")).toBe(true);
      expect(store.isOptimisticUpdate("pool:depositor:456")).toBe(true);

      // Loan repayment fails and is rolled back
      act(() => {
        store.removeOptimisticUpdate("loan:101:repayment");
      });

      expect(store.isOptimisticUpdate("loan:101:repayment")).toBe(false);
      // Pool deposit optimistic state must remain untouched
      expect(store.isOptimisticUpdate("pool:depositor:456")).toBe(true);
    });

    it("preserves correct rollback ordering when conflicting mutations target the same entity", () => {
      const store = useOptimisticUI.getState();
      const entityKey = "loan:repayment:999";

      // Sequence of mutations on same loan
      const rollbackStack: string[] = [];

      act(() => {
        store.startTransaction("tx-first", "First repayment attempt");
        store.addOptimisticUpdate(entityKey);
        rollbackStack.push("tx-first");

        store.startTransaction("tx-second", "Second repayment attempt");
        rollbackStack.push("tx-second");
      });

      expect(store.isOptimisticUpdate(entityKey)).toBe(true);

      // First transaction fails (e.g. sequence number conflict or auth rejection)
      act(() => {
        store.failTransaction("tx-first", "Transaction sequence number conflict");
        // Rollback first transaction from stack
        const failedTx = rollbackStack.shift();
        if (failedTx === "tx-first" && rollbackStack.length === 1) {
          // If a subsequent mutation is still in-flight, optimistic update remains active
          expect(store.isOptimisticUpdate(entityKey)).toBe(true);
        }
      });

      expect(store.getTransaction("tx-first")?.status).toBe("failed");
      expect(store.getTransaction("tx-second")?.status).toBe("pending");

      // Now second transaction also fails, triggering final rollback
      act(() => {
        store.failTransaction("tx-second", "Network timeout on ledger submission");
        rollbackStack.pop();
        store.removeOptimisticUpdate(entityKey);
      });

      expect(store.getTransaction("tx-second")?.status).toBe("failed");
      expect(store.isOptimisticUpdate(entityKey)).toBe(false);
    });
  });

  // =========================================================================
  // 3. Success Paths & Status Contract
  // =========================================================================
  describe("Success Paths", () => {
    it("transitions through complete happy-path lifecycle with expected statuses and progress", () => {
      const store = useOptimisticUI.getState();
      const id = "tx-full-lifecycle";

      act(() => {
        store.startTransaction(id, "Initializing transaction");
      });
      let tx = store.getTransaction(id);
      expect(tx?.status).toBe("pending");
      expect(tx?.progress).toBe(0);

      act(() => {
        store.signTransaction(id, "Awaiting wallet signature");
      });
      tx = store.getTransaction(id);
      expect(tx?.status).toBe("signing");
      expect(tx?.progress).toBe(40);
      expect(tx?.message).toBe("Awaiting wallet signature");

      act(() => {
        store.submitTransaction(id, "0xabc123", "Submitted to Horizon");
      });
      tx = store.getTransaction(id);
      expect(tx?.status).toBe("submitted");
      expect(tx?.progress).toBe(70);
      expect(tx?.txHash).toBe("0xabc123");

      act(() => {
        store.confirmTransaction(id, "Waiting for ledger close");
      });
      tx = store.getTransaction(id);
      expect(tx?.status).toBe("confirming");
      expect(tx?.progress).toBe(90);

      act(() => {
        store.completeTransaction(id, "0xabc123", "Transaction confirmed!");
      });
      tx = store.getTransaction(id);
      expect(tx?.status).toBe("confirmed");
      expect(tx?.progress).toBe(100);
      expect(tx?.confirmedAt).toBeDefined();
    });

    it("correctly computes convenience boolean flags in useTransaction hook", () => {
      const id = "tx-flags-test";
      const { result } = renderHook(() => useTransaction(id));

      expect(result.current.isLoading).toBe(false);
      expect(result.current.isSuccess).toBe(false);
      expect(result.current.isError).toBe(false);

      act(() => {
        result.current.start("Starting");
      });
      expect(result.current.isLoading).toBe(true);

      act(() => {
        result.current.sign("Signing");
      });
      expect(result.current.isSigning).toBe(true);
      expect(result.current.isLoading).toBe(true);

      act(() => {
        result.current.submit("hash-123", "Submitted");
      });
      expect(result.current.isSubmitted).toBe(true);
      expect(result.current.isLoading).toBe(true);

      act(() => {
        result.current.confirm("Confirming");
      });
      expect(result.current.isConfirming).toBe(true);
      expect(result.current.isLoading).toBe(true);

      act(() => {
        result.current.complete("hash-123", "Success");
      });
      expect(result.current.isSuccess).toBe(true);
      expect(result.current.isLoading).toBe(false);
    });
  });

  // =========================================================================
  // 4. Failure Paths & Error Contract
  // =========================================================================
  describe("Failure Paths & Error Contract", () => {
    it("asserts public error contract when a transaction fails", () => {
      const store = useOptimisticUI.getState();
      const id = "tx-error-contract";

      act(() => {
        store.startTransaction(id, "Starting loan issuance");
        store.signTransaction(id);
        store.failTransaction(id, "RPC 504 Gateway Timeout");
      });

      const tx = store.getTransaction(id);
      expect(tx?.status).toBe("failed");
      expect(tx?.error).toBe("RPC 504 Gateway Timeout");
      expect(tx?.startTime).toBeDefined();
      expect(tx?.confirmedAt).toBeUndefined();
    });

    it("updates hook boolean error state and halts loading", () => {
      const id = "tx-hook-error";
      const { result } = renderHook(() => useTransaction(id));

      act(() => {
        result.current.start("Processing");
        result.current.fail("Contract error: insufficient collateral");
      });

      expect(result.current.isError).toBe(true);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.transaction?.error).toBe("Contract error: insufficient collateral");
    });
  });

  // =========================================================================
  // 5. Authorization Paths
  // =========================================================================
  describe("Authorization Paths", () => {
    it("handles wallet authorization rejection and rolls back optimistic updates", () => {
      const store = useOptimisticUI.getState();
      const id = "tx-auth-denied";
      const optKey = "wallet:signing:borrower";

      act(() => {
        store.addOptimisticUpdate(optKey);
        store.startTransaction(id, "Awaiting user approval");
        store.signTransaction(id, "Waiting for Freighter prompt");
      });

      expect(store.isOptimisticUpdate(optKey)).toBe(true);
      expect(store.getTransaction(id)?.status).toBe("signing");

      // User rejects signature prompt in wallet
      act(() => {
        store.failTransaction(id, "User declined transaction signature");
        store.removeOptimisticUpdate(optKey);
      });

      expect(store.getTransaction(id)?.status).toBe("failed");
      expect(store.getTransaction(id)?.error).toBe("User declined transaction signature");
      expect(store.isOptimisticUpdate(optKey)).toBe(false);
    });

    it("handles 401 Unauthorized / session expiration with clean rollback", () => {
      const store = useOptimisticUI.getState();
      const id = "tx-session-expired";
      const optKey = "admin:disburse:loan";

      act(() => {
        store.addOptimisticUpdate(optKey);
        store.startTransaction(id, "Disbursing loan funds");
      });

      // API responds with 401 Unauthorized
      act(() => {
        store.failTransaction(id, "401 Unauthorized: Session token expired");
        store.removeOptimisticUpdate(optKey);
      });

      expect(store.getTransaction(id)?.error).toBe("401 Unauthorized: Session token expired");
      expect(store.isOptimisticUpdate(optKey)).toBe(false);
    });

    it("handles 403 Forbidden role failure with deterministic error assertion", () => {
      const store = useOptimisticUI.getState();
      const id = "tx-forbidden";

      act(() => {
        store.startTransaction(id, "Administrative action");
        store.failTransaction(id, "403 Forbidden: Caller lacks admin permissions");
      });

      expect(store.getTransaction(id)?.error).toBe("403 Forbidden: Caller lacks admin permissions");
      expect(store.getTransaction(id)?.status).toBe("failed");
    });
  });

  // =========================================================================
  // 6. Boundary Conditions
  // =========================================================================
  describe("Boundary Conditions", () => {
    it("gracefully no-ops when modifying non-existent transaction IDs without throwing", () => {
      const store = useOptimisticUI.getState();
      const nonExistent = "non-existent-id";

      expect(() => {
        act(() => {
          store.updateProgress(nonExistent, 50, "no-op");
          store.signTransaction(nonExistent);
          store.submitTransaction(nonExistent, "hash");
          store.confirmTransaction(nonExistent);
          store.completeTransaction(nonExistent);
          store.failTransaction(nonExistent, "error");
        });
      }).not.toThrow();

      expect(store.getTransaction(nonExistent)).toBeUndefined();
    });

    it("clamps progress values strictly between 0 and 100", () => {
      const store = useOptimisticUI.getState();
      const id = "tx-boundary-progress";

      act(() => {
        store.startTransaction(id, "Testing bounds");
        store.updateProgress(id, -45);
      });
      expect(store.getTransaction(id)?.progress).toBe(0);

      act(() => {
        store.updateProgress(id, 175);
      });
      expect(store.getTransaction(id)?.progress).toBe(100);
    });

    it("clears specific transaction while preserving others in the store", () => {
      const store = useOptimisticUI.getState();

      act(() => {
        store.startTransaction("tx-retain", "Retained");
        store.startTransaction("tx-remove", "To remove");
        store.clearTransaction("tx-remove");
      });

      expect(store.getTransaction("tx-remove")).toBeUndefined();
      expect(store.getTransaction("tx-retain")).toBeDefined();
      expect(store.getTransaction("tx-retain")?.message).toBe("Retained");
    });

    it("handles idempotent optimistic update Set operations", () => {
      const store = useOptimisticUI.getState();
      const key = "idempotent-key";

      act(() => {
        store.addOptimisticUpdate(key);
        store.addOptimisticUpdate(key); // Duplicate add
      });
      expect(store.isOptimisticUpdate(key)).toBe(true);

      act(() => {
        store.removeOptimisticUpdate(key);
        store.removeOptimisticUpdate(key); // Duplicate remove
      });
      expect(store.isOptimisticUpdate(key)).toBe(false);
    });

    it("auto-dismisses confirmed transactions after 3000ms delay", () => {
      const id = "tx-auto-dismiss";
      const { result } = renderHook(() => useTransaction(id));

      act(() => {
        result.current.start("Starting");
        result.current.complete("hash-dismiss", "All done");
      });

      expect(result.current.transaction?.status).toBe("confirmed");

      // Advance timers by 2999ms - should still be present
      act(() => {
        jest.advanceTimersByTime(2999);
      });
      expect(useOptimisticUI.getState().getTransaction(id)).toBeDefined();

      // Advance by 1ms (reaching 3000ms) - should be cleared
      act(() => {
        jest.advanceTimersByTime(1);
      });
      expect(useOptimisticUI.getState().getTransaction(id)).toBeUndefined();
    });

    it("clears immediately if confirmedAt is already older than 3000ms", () => {
      const id = "tx-old-confirmed";
      const store = useOptimisticUI.getState();

      act(() => {
        store.startTransaction(id, "Old transaction");
        store.completeTransaction(id, "hash-old");
        // Artificially age confirmedAt
        const tx = store.getTransaction(id);
        if (tx) {
          tx.confirmedAt = Date.now() - 5000;
        }
      });

      renderHook(() => useTransaction(id));

      expect(store.getTransaction(id)).toBeUndefined();
    });
  });
});
