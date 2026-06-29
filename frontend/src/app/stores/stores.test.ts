/**
 * stores/stores.test.ts
 *
 * Unit tests for all Zustand stores.
 * Tests run against the store's actions and derived state.
 */

import { useUserStore } from "./useUserStore";
import { useWalletStore } from "./useWalletStore";
import { useUIStore } from "./useUIStore";
import { THEME_STORAGE_KEY } from "../lib/theme";
import { useThemeStore } from "./useThemeStore";
import {
  getNextLevelInfo,
  LEVEL_THRESHOLDS,
  useGamificationStore,
} from "./useGamificationStore";
import type { ModalId } from "./useUIStore";

// Reset store state between tests
beforeEach(() => {
  useUserStore.setState({ user: null, isLoading: false, error: null, isAuthenticated: false });
  useWalletStore.setState({
    status: "disconnected",
    address: null,
    network: null,
    balances: [],
    isLoadingBalances: false,
    error: null,
    shouldAutoReconnect: false,
  });
  useUIStore.setState((state) => ({
    ...state,
    toasts: [],
    isGlobalLoading: false,
    globalLoadingMessage: null,
  }));
  useThemeStore.setState({
    theme: "light",
    hydrated: false,
  });
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
  delete document.documentElement.dataset.theme;
  useGamificationStore.getState().resetGamification();
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
  const mockNetwork = { chainId: 2, name: "TESTNET", isSupported: true };

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
    expect(network?.chainId).toBe(2);
    expect(useWalletStore.getState().shouldAutoReconnect).toBe(true);
  });

  it("disconnect resets to initial state", () => {
    useWalletStore.getState().setConnected("0x123", mockNetwork);
    useWalletStore.getState().disconnect();

    const { status, address, balances } = useWalletStore.getState();
    expect(status).toBe("disconnected");
    expect(address).toBeNull();
    expect(balances).toHaveLength(0);
    expect(useWalletStore.getState().shouldAutoReconnect).toBe(false);
  });

  it("setBalances stores balances and clears loading flag", () => {
    useWalletStore.getState().setLoadingBalances(true);
    useWalletStore.getState().setBalances([{ symbol: "ETH", amount: "1.5", usdValue: 3000 }]);

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

// ─── useThemeStore ───────────────────────────────────────────────────────────

describe("useThemeStore", () => {
  it("uses the system preference on first visit when nothing is stored", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: jest.fn().mockImplementation(() => ({
        matches: true,
        media: "(prefers-color-scheme: dark)",
        onchange: null,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        addListener: jest.fn(),
        removeListener: jest.fn(),
        dispatchEvent: jest.fn(),
      })),
    });

    useThemeStore.getState().initializeTheme();

    const { theme, hydrated } = useThemeStore.getState();
    expect(theme).toBe("dark");
    expect(hydrated).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it("persists an explicit theme selection and applies it to the document", () => {
    useThemeStore.getState().setTheme("dark");

    const { theme, hydrated } = useThemeStore.getState();
    expect(theme).toBe("dark");
    expect(hydrated).toBe(true);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("cycles through light → dark → system → light when toggled", () => {
    useThemeStore.setState({ theme: "system", hydrated: true });

    useThemeStore.getState().toggleTheme();

    const { theme } = useThemeStore.getState();
    expect(theme).toBe("light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});

// ─── useGamificationStore ────────────────────────────────────────────────────

describe("useGamificationStore", () => {
  describe("addXP / checkLevelUp", () => {
    it.each(
      LEVEL_THRESHOLDS.slice(1).map((threshold) => {
        const previousThreshold = LEVEL_THRESHOLDS[threshold.level - 2];
        return {
          fromXp: threshold.xpRequired - 1,
          addAmount: 1,
          expectedLevel: threshold.level,
          expectedTitle: threshold.title,
          expectedReward: threshold,
        };
      }),
    )(
      "crossing level $expectedLevel threshold ($expectedTitle) updates level-up state",
      ({ fromXp, addAmount, expectedLevel, expectedTitle, expectedReward }) => {
        const previousLevel = expectedLevel - 1;
        const previousTitle = LEVEL_THRESHOLDS[previousLevel - 1].title;

        useGamificationStore.setState({
          xp: fromXp,
          level: previousLevel,
          kingdomTitle: previousTitle,
          showLevelUpModal: false,
          pendingLevelUp: null,
        });

        useGamificationStore.getState().addXP(addAmount);

        const state = useGamificationStore.getState();
        expect(state.xp).toBe(fromXp + addAmount);
        expect(state.level).toBe(expectedLevel);
        expect(state.kingdomTitle).toBe(expectedTitle);
        expect(state.showLevelUpModal).toBe(true);
        expect(state.pendingLevelUp).toEqual(expectedReward);
      },
    );

    it("does not trigger level-up when XP stays within the current level", () => {
      useGamificationStore.setState({
        xp: 50,
        level: 1,
        kingdomTitle: "Peasant",
        showLevelUpModal: false,
        pendingLevelUp: null,
      });

      useGamificationStore.getState().addXP(10);

      const state = useGamificationStore.getState();
      expect(state.xp).toBe(60);
      expect(state.level).toBe(1);
      expect(state.kingdomTitle).toBe("Peasant");
      expect(state.showLevelUpModal).toBe(false);
      expect(state.pendingLevelUp).toBeNull();
    });

    it("dismissLevelUp clears the modal and pending reward", () => {
      useGamificationStore.getState().addXP(100);
      useGamificationStore.getState().dismissLevelUp();

      const state = useGamificationStore.getState();
      expect(state.showLevelUpModal).toBe(false);
      expect(state.pendingLevelUp).toBeNull();
      expect(state.level).toBe(2);
    });
  });

  describe("getNextLevelInfo / calculateLevel", () => {
    it.each([
      { xp: 0, currentLevel: 1, nextLevel: 2, xpToNext: 100, progress: 0 },
      { xp: 50, currentLevel: 1, nextLevel: 2, xpToNext: 50, progress: 50 },
      { xp: 99, currentLevel: 1, nextLevel: 2, xpToNext: 1, progress: 99 },
      { xp: 100, currentLevel: 2, nextLevel: 3, xpToNext: 200, progress: 0 },
      { xp: 299, currentLevel: 2, nextLevel: 3, xpToNext: 1, progress: 99.5 },
      { xp: 600, currentLevel: 4, nextLevel: 5, xpToNext: 400, progress: 0 },
      { xp: 2499, currentLevel: 6, nextLevel: 7, xpToNext: 1, progress: 99.9 },
      { xp: 2500, currentLevel: 7, nextLevel: 7, xpToNext: 0, progress: 100 },
      { xp: 5000, currentLevel: 7, nextLevel: 7, xpToNext: 0, progress: 100 },
    ])("at $xp XP returns correct level progression info", ({ xp, ...expected }) => {
      expect(getNextLevelInfo(xp)).toEqual(expected);
    });

    it("clamps progress to 0 when XP is below the current level floor", () => {
      expect(getNextLevelInfo(-10)).toEqual({
        currentLevel: 1,
        nextLevel: 2,
        xpToNext: 110,
        progress: 0,
      });
    });
  });

  describe("unlockAchievement", () => {
    it("sets unlockedAt and maxes progress for the target achievement", () => {
      useGamificationStore.getState().unlockAchievement("first_loan");

      const achievement = useGamificationStore
        .getState()
        .achievements.find((a) => a.id === "first_loan");

      expect(achievement?.unlockedAt).toBeDefined();
      expect(achievement?.progress).toBe(achievement?.maxProgress);
    });
  });

  describe("updateAchievementProgress", () => {
    it("sets unlockedAt exactly once when progress reaches maxProgress", () => {
      const { updateAchievementProgress } = useGamificationStore.getState();

      updateAchievementProgress("first_loan", 0);
      let achievement = useGamificationStore
        .getState()
        .achievements.find((a) => a.id === "first_loan");
      expect(achievement?.unlockedAt).toBeUndefined();

      updateAchievementProgress("first_loan", 1);
      achievement = useGamificationStore
        .getState()
        .achievements.find((a) => a.id === "first_loan");
      const firstUnlock = achievement?.unlockedAt;
      expect(firstUnlock).toBeDefined();

      updateAchievementProgress("first_loan", 1);
      achievement = useGamificationStore
        .getState()
        .achievements.find((a) => a.id === "first_loan");
      expect(achievement?.unlockedAt).toBe(firstUnlock);
    });

    it("clamps progress to maxProgress", () => {
      useGamificationStore.getState().updateAchievementProgress("five_loans", 10);

      const achievement = useGamificationStore
        .getState()
        .achievements.find((a) => a.id === "five_loans");

      expect(achievement?.progress).toBe(5);
      expect(achievement?.unlockedAt).toBeDefined();
    });
  });
});
