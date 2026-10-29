/**
 * stores/__tests__/useGamificationStore.rewardDedup.test.ts
 *
 * Regression coverage for #2138: gamification state had no tests guarding
 * against duplicate rewards when an action is retried or state is replayed.
 *
 * What the store guarantees (and these tests pin down):
 *  - the level-up celebration fires once per level, however often it is re-checked
 *  - a retried achievement unlock never creates a second entry
 *  - progress updates never re-stamp an already unlocked achievement
 *  - rewards survive a reload without replaying transient UI (modal / animation)
 *
 * What it deliberately does NOT do: `addXP` credits every call. Idempotency for
 * XP is the caller's responsibility, and the XP-gain animation is de-duplicated
 * by `recentXPGain.id` in `GlobalXPGain`. Those contracts are asserted below too,
 * so a future change to either side is a conscious one.
 */

import { LEVEL_THRESHOLDS, useGamificationStore, type Achievement } from "../useGamificationStore";

const STORAGE_KEY = "remitlend-gamification";

const state = () => useGamificationStore.getState();

beforeEach(() => {
  window.localStorage.clear();
  state().resetGamification();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("level-up celebration is awarded once per level", () => {
  it("does not replay after the modal is dismissed and the level is re-checked", () => {
    state().addXP(100);
    expect(state().showLevelUpModal).toBe(true);
    state().dismissLevelUp();

    state().checkLevelUp();
    state().checkLevelUp();
    state().checkLevelUp();

    expect(state().level).toBe(2);
    expect(state().showLevelUpModal).toBe(false);
    expect(state().pendingLevelUp).toBeNull();
  });

  it("keeps a single pending reward when the level is re-checked while the modal is open", () => {
    state().addXP(100);
    const pending = state().pendingLevelUp;

    state().checkLevelUp();

    expect(state().pendingLevelUp).toBe(pending);
    expect(state().level).toBe(2);
  });

  it("does not reopen the celebration for XP earned inside the current level", () => {
    state().addXP(100);
    state().dismissLevelUp();

    state().addXP(50);
    state().addXP(50);

    expect(state().xp).toBe(200);
    expect(state().level).toBe(2);
    expect(state().showLevelUpModal).toBe(false);
  });

  it("celebrates only the final level when one reward crosses several thresholds", () => {
    state().addXP(1000);

    expect(state().level).toBe(5);
    expect(state().kingdomTitle).toBe("Duke");
    expect(state().pendingLevelUp).toEqual(LEVEL_THRESHOLDS[4]);
    expect(state().showLevelUpModal).toBe(true);
  });

  it("stays below the next level one XP short of the threshold, then levels up exactly on it", () => {
    state().addXP(99);
    expect(state().level).toBe(1);
    expect(state().showLevelUpModal).toBe(false);

    state().addXP(1);
    expect(state().level).toBe(2);
    expect(state().showLevelUpModal).toBe(true);
  });

  it("does not level past the maximum, and re-awarding XP at the cap never reopens the modal", () => {
    const max = LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1];
    state().addXP(max.xpRequired + 5_000);
    expect(state().level).toBe(max.level);
    expect(state().kingdomTitle).toBe(max.title);
    state().dismissLevelUp();

    state().addXP(1_000);

    expect(state().level).toBe(max.level);
    expect(state().showLevelUpModal).toBe(false);
  });

  it("never lowers the level when XP is later reduced", () => {
    state().addXP(300);
    expect(state().level).toBe(3);
    state().dismissLevelUp();

    state().addXP(-250);

    expect(state().level).toBe(3);
    expect(state().showLevelUpModal).toBe(false);
  });
});

describe("XP is credited per call; the animation is de-duplicated by recentXPGain.id", () => {
  it("credits every addXP call, so callers must not retry a reward", () => {
    state().addXP(10, "Wallet connection");
    state().addXP(10, "Wallet connection");

    expect(state().xp).toBe(20);
  });

  it("publishes the amount and reason of the latest reward", () => {
    state().addXP(50, "Loan repayment");

    expect(state().recentXPGain).toMatchObject({ amount: 50, reason: "Loan repayment" });
  });

  it("defaults the reason to an empty string", () => {
    state().addXP(5);

    expect(state().recentXPGain?.reason).toBe("");
  });

  it("gives rewards in different milliseconds different ids", () => {
    const now = jest.spyOn(Date, "now");
    now.mockReturnValue(1_000);
    state().addXP(10, "first");
    const firstId = state().recentXPGain?.id;

    now.mockReturnValue(1_001);
    state().addXP(10, "second");
    const secondId = state().recentXPGain?.id;

    expect(firstId).toBe(1_000);
    expect(secondId).toBe(1_001);
    expect(secondId).not.toBe(firstId);
  });

  it("reuses the id for rewards landing in the same millisecond (GlobalXPGain shows them once)", () => {
    jest.spyOn(Date, "now").mockReturnValue(5_000);

    state().addXP(10, "first");
    const firstId = state().recentXPGain?.id;
    state().addXP(25, "second");

    // The XP is credited twice, but the shared id is what the animation queue
    // de-duplicates on, so only the latest gain is published under that id.
    expect(state().xp).toBe(35);
    expect(state().recentXPGain?.id).toBe(firstId);
    expect(state().recentXPGain).toMatchObject({ amount: 25, reason: "second" });
  });

  it("clears the published gain without touching XP", () => {
    state().addXP(40, "Profile completion");

    state().clearRecentXPGain();

    expect(state().recentXPGain).toBeNull();
    expect(state().xp).toBe(40);
  });
});

describe("achievements are not duplicated by retries", () => {
  const find = (id: string): Achievement | undefined =>
    state().achievements.find((a) => a.id === id);

  it("keeps exactly one entry per achievement when an unlock is retried", () => {
    const before = state().achievements.length;

    state().unlockAchievement("first_repayment");
    state().unlockAchievement("first_repayment");
    state().unlockAchievement("first_repayment");

    const ids = state().achievements.map((a) => a.id);
    expect(state().achievements).toHaveLength(before);
    expect(new Set(ids).size).toBe(ids.length);
    expect(find("first_repayment")?.progress).toBe(find("first_repayment")?.maxProgress);
    expect(find("first_repayment")?.unlockedAt).toBeDefined();
  });

  it("leaves every other achievement untouched when one is unlocked", () => {
    const untouched = state().achievements.filter((a) => a.id !== "first_loan");

    state().unlockAchievement("first_loan");

    expect(state().achievements.filter((a) => a.id !== "first_loan")).toEqual(untouched);
  });

  it("ignores an unknown achievement id", () => {
    const before = state().achievements;

    state().unlockAchievement("does_not_exist");
    state().updateAchievementProgress("does_not_exist", 3);

    expect(state().achievements).toEqual(before);
  });

  it("does not re-stamp an unlocked achievement when progress is updated again", () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    state().unlockAchievement("first_loan");
    const stamp = find("first_loan")?.unlockedAt;
    expect(stamp).toBe("2026-01-01T00:00:00.000Z");

    jest.setSystemTime(new Date("2026-06-01T00:00:00.000Z"));
    state().updateAchievementProgress("first_loan", 1);
    state().updateAchievementProgress("first_loan", 1);

    expect(find("first_loan")?.unlockedAt).toBe(stamp);
  });

  it("treats a repeated progress update as a no-op and caps it at the maximum", () => {
    state().updateAchievementProgress("streak_master", 4);
    const once = find("streak_master");

    state().updateAchievementProgress("streak_master", 4);
    expect(find("streak_master")).toEqual(once);
    expect(find("streak_master")?.unlockedAt).toBeUndefined();

    state().updateAchievementProgress("streak_master", 999);
    expect(find("streak_master")?.progress).toBe(10);
    expect(find("streak_master")?.unlockedAt).toBeDefined();
  });
});

describe("rewards survive a reload without replaying transient UI", () => {
  it("keeps earned XP and level after a reload and does not reopen the modal", async () => {
    state().addXP(100);
    expect(state().showLevelUpModal).toBe(true);
    const persisted = window.localStorage.getItem(STORAGE_KEY);
    expect(persisted).not.toBeNull();

    // Reload: in-memory state is gone; only what was written to storage remains.
    // (setState persists too, so the saved payload is restored before rehydrating.)
    useGamificationStore.setState({
      xp: 0,
      level: 1,
      kingdomTitle: "Peasant",
      showLevelUpModal: false,
      pendingLevelUp: null,
      recentXPGain: null,
    });
    window.localStorage.setItem(STORAGE_KEY, persisted as string);
    await useGamificationStore.persist.rehydrate();

    expect(state().xp).toBe(100);
    expect(state().level).toBe(2);
    expect(state().showLevelUpModal).toBe(false);
    expect(state().pendingLevelUp).toBeNull();
    expect(state().recentXPGain).toBeNull();
  });

  it("does not credit XP again when persisted state is rehydrated repeatedly", async () => {
    state().addXP(100);

    await useGamificationStore.persist.rehydrate();
    await useGamificationStore.persist.rehydrate();

    expect(state().xp).toBe(100);
    expect(state().level).toBe(2);
  });

  it("resets progression, achievements and transient state together", () => {
    state().addXP(300, "Loan repayment");
    state().unlockAchievement("first_loan");

    state().resetGamification();

    expect(state().xp).toBe(0);
    expect(state().level).toBe(1);
    expect(state().kingdomTitle).toBe("Peasant");
    expect(state().recentXPGain).toBeNull();
    expect(state().showLevelUpModal).toBe(false);
    expect(state().achievements.every((a) => !a.unlockedAt)).toBe(true);
    // The reset is persisted, so a reload cannot resurrect the old reward.
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(stored.state?.xp).toBe(0);
  });
});
