/**
 * stores/stores.test.ts
 *
 * Unit tests for all three Zustand stores.
 * Tests run against the store's actions and derived state.
 */

import { useUserStore } from "./useUserStore";
import { useWalletStore } from "./useWalletStore";
import { useUIStore } from "./useUIStore";
import type { ModalId } from "./useUIStore";

// Reset store state between tests
beforeEach(() => {
    useUserStore.setState({ user: null, isLoading: false, error: null, isAuthenticated: false });
    useWalletStore.setState({ status: "disconnected", address: null, network: null, balances: [], isLoadingBalances: false, error: null });
    useUIStore.setState((state) => ({
        ...state,
        toasts: [],
        isGlobalLoading: false,
        globalLoadingMessage: null,
    }));
});

// ─── useUserStore ────────────────────────────────────────────────────────────

describe("useUserStore", () => {
    it("starts unauthenticated", () => {
        const { user, isAuthenticated } = useUserStore.getState();
        expect(user).toBeNull();
        expect(isAuthenticated).toBe(false);
    });

    it("setUser marks the user as authenticated", () => {
        useUserStore.getState().setUser({
            id: "u1",
            email: "alice@example.com",
            kycVerified: true,
        });

        const { user, isAuthenticated, error } = useUserStore.getState();
        expect(user?.id).toBe("u1");
        expect(user?.email).toBe("alice@example.com");
        expect(isAuthenticated).toBe(true);
        expect(error).toBeNull();
        expect(user?.sessionStartedAt).toBeDefined();
    });

    it("clearUser resets everything", () => {
        useUserStore.getState().setUser({ id: "u1", email: "a@a.com", kycVerified: false });
        useUserStore.getState().clearUser();

        const { user, isAuthenticated } = useUserStore.getState();
        expect(user).toBeNull();
        expect(isAuthenticated).toBe(false);
    });

    it("updateUser patches existing user fields", () => {
        useUserStore.getState().setUser({ id: "u1", email: "a@a.com", kycVerified: false });
        useUserStore.getState().updateUser({ kycVerified: true, walletAddress: "0xABC" });

        const { user } = useUserStore.getState();
        expect(user?.kycVerified).toBe(true);
        expect(user?.walletAddress).toBe("0xABC");
        expect(user?.email).toBe("a@a.com"); // other fields preserved
    });

    it("setError stores the error and marks not loading", () => {
        useUserStore.getState().setLoading(true);
        useUserStore.getState().setError("Invalid credentials");

        const { error, isLoading } = useUserStore.getState();
        expect(error).toBe("Invalid credentials");
        expect(isLoading).toBe(false);
    });
});

// ─── useWalletStore ──────────────────────────────────────────────────────────

describe("useWalletStore", () => {
    const mockNetwork = { chainId: 1, name: "Ethereum", isSupported: true };

    it("starts disconnected", () => {
        const { status, address } = useWalletStore.getState();
        expect(status).toBe("disconnected");
        expect(address).toBeNull();
    });

    it("setConnected stores address and network", () => {
        useWalletStore.getState().setConnected("0x123", mockNetwork);

        const { status, address, network } = useWalletStore.getState();
        expect(status).toBe("connected");
        expect(address).toBe("0x123");
        expect(network?.chainId).toBe(1);
    });

    it("disconnect resets to initial state", () => {
        useWalletStore.getState().setConnected("0x123", mockNetwork);
        useWalletStore.getState().disconnect();

        const { status, address, balances } = useWalletStore.getState();
        expect(status).toBe("disconnected");
        expect(address).toBeNull();
        expect(balances).toHaveLength(0);
    });

    it("setBalances stores balances and clears loading flag", () => {
        useWalletStore.getState().setLoadingBalances(true);
        useWalletStore.getState().setBalances([
            { symbol: "ETH", amount: "1.5", usdValue: 3000 },
        ]);

        const { balances, isLoadingBalances } = useWalletStore.getState();
        expect(balances).toHaveLength(1);
        expect(balances[0]?.symbol).toBe("ETH");
        expect(isLoadingBalances).toBe(false);
    });

    it("setError stores error and sets status to error", () => {
        useWalletStore.getState().setError("User rejected connection");

        const { error, status } = useWalletStore.getState();
        expect(error).toBe("User rejected connection");
        expect(status).toBe("error");
    });
});

// ─── useUIStore ──────────────────────────────────────────────────────────────

describe("useUIStore", () => {
    it("all modals start closed", () => {
        const { modals } = useUIStore.getState();
        Object.values(modals).forEach((m) => {
            expect(m.isOpen).toBe(false);
        });
    });

    it("openModal opens the target modal with data", () => {
        const modalId: ModalId = "connectWallet";
        useUIStore.getState().openModal(modalId, { step: 1 });

        const modal = useUIStore.getState().modals[modalId];
        expect(modal.isOpen).toBe(true);
        expect((modal.data as { step: number }).step).toBe(1);
    });

    it("closeModal closes the target modal", () => {
        const modalId: ModalId = "confirmLoan";
        useUIStore.getState().openModal(modalId);
        useUIStore.getState().closeModal(modalId);

        expect(useUIStore.getState().modals[modalId].isOpen).toBe(false);
    });

    it("closeAllModals closes every modal", () => {
        useUIStore.getState().openModal("connectWallet");
        useUIStore.getState().openModal("confirmLoan");
        useUIStore.getState().closeAllModals();

        const { modals } = useUIStore.getState();
        Object.values(modals).forEach((m) => expect(m.isOpen).toBe(false));
    });

    it("addToast adds to the queue and returns an id", () => {
        const id = useUIStore.getState().addToast({
            message: "Loan submitted!",
            variant: "success",
            duration: 3000,
        });

        const { toasts } = useUIStore.getState();
        expect(toasts).toHaveLength(1);
        expect(toasts[0]?.id).toBe(id);
        expect(toasts[0]?.message).toBe("Loan submitted!");
    });

    it("dismissToast removes the toast by id", () => {
        const id = useUIStore.getState().addToast({
            message: "Note",
            variant: "info",
            duration: 3000,
        });
        useUIStore.getState().dismissToast(id);

        expect(useUIStore.getState().toasts).toHaveLength(0);
    });

    it("showGlobalLoading/hideGlobalLoading toggle the overlay", () => {
        useUIStore.getState().showGlobalLoading("Processing transaction…");
        expect(useUIStore.getState().isGlobalLoading).toBe(true);
        expect(useUIStore.getState().globalLoadingMessage).toBe("Processing transaction…");

        useUIStore.getState().hideGlobalLoading();
        expect(useUIStore.getState().isGlobalLoading).toBe(false);
        expect(useUIStore.getState().globalLoadingMessage).toBeNull();
    });
});
