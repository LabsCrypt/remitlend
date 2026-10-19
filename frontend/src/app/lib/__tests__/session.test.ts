import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { isJwtExpired, clearSessionState, logoutUser, SessionExpiredError } from "../session";
import * as userStore from "../../stores/useUserStore";
import * as walletStore from "../../stores/useWalletStore";

vi.mock("../../stores/useUserStore", () => ({
  useUserStore: {
    getState: vi.fn(() => ({
      clearUser: vi.fn(),
    })),
  },
}));

vi.mock("../../stores/useWalletStore", () => ({
  useWalletStore: {
    getState: vi.fn(() => ({
      disconnect: vi.fn(),
    })),
  },
}));

describe("session.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe("isJwtExpired", () => {
    it("returns true for expired token", () => {
      const exp = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
      const payload = btoa(JSON.stringify({ exp, sub: "test" }));
      const token = `header.${payload}.signature`;

      expect(isJwtExpired(token)).toBe(true);
    });

    it("returns false for valid token", () => {
      const exp = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
      const payload = btoa(JSON.stringify({ exp, sub: "test" }));
      const token = `header.${payload}.signature`;

      expect(isJwtExpired(token)).toBe(false);
    });

    it("returns false for token expiring exactly now", () => {
      const exp = Math.floor(Date.now() / 1000);
      const payload = btoa(JSON.stringify({ exp, sub: "test" }));
      const token = `header.${payload}.signature`;

      expect(isJwtExpired(token)).toBe(false);
    });

    it("returns true for token that expired 1 millisecond ago", () => {
      const exp = Math.floor(Date.now() / 1000);
      const payload = btoa(JSON.stringify({ exp, sub: "test" }));
      const token = `header.${payload}.signature`;

      // Travel 1ms into the future
      vi.useFakeTimers();
      vi.setSystemTime(Date.now() + 1);
      const result = isJwtExpired(token);
      vi.useRealTimers();

      expect(result).toBe(true);
    });

    it("returns false for malformed token missing payload", () => {
      const token = "header.signature";
      expect(isJwtExpired(token)).toBe(false);
    });

    it("returns false for token with invalid base64", () => {
      const token = "header.!!!invalid!!!.signature";
      expect(isJwtExpired(token)).toBe(false);
    });

    it("returns false for token with missing exp field", () => {
      const payload = btoa(JSON.stringify({ sub: "test" }));
      const token = `header.${payload}.signature`;

      expect(isJwtExpired(token)).toBe(false);
    });

    it("returns false for token with non-numeric exp field", () => {
      const payload = btoa(JSON.stringify({ exp: "not-a-number", sub: "test" }));
      const token = `header.${payload}.signature`;

      expect(isJwtExpired(token)).toBe(false);
    });

    it("handles base64url padding correctly", () => {
      // Test with payload that needs padding
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const payloadObj = { exp, sub: "test" };
      const payload = btoa(JSON.stringify(payloadObj))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");
      const token = `header.${payload}.signature`;

      expect(isJwtExpired(token)).toBe(false);
    });
  });

  describe("clearSessionState", () => {
    it("clears user from store", () => {
      const clearUserMock = vi.fn();
      vi.mocked(userStore.useUserStore.getState).mockReturnValue({
        clearUser: clearUserMock,
      } as any);

      clearSessionState();

      expect(clearUserMock).toHaveBeenCalled();
    });

    it("disconnects wallet from store", () => {
      const disconnectMock = vi.fn();
      vi.mocked(walletStore.useWalletStore.getState).mockReturnValue({
        disconnect: disconnectMock,
      } as any);

      clearSessionState();

      expect(disconnectMock).toHaveBeenCalled();
    });

    it("clears user localStorage key", () => {
      localStorage.setItem("remitlend-user", '{"name":"test"}');

      clearSessionState();

      expect(localStorage.getItem("remitlend-user")).toBeNull();
    });

    it("clears wallet localStorage key", () => {
      localStorage.setItem("remitlend-wallet", '{"address":"0x123"}');

      clearSessionState();

      expect(localStorage.getItem("remitlend-wallet")).toBeNull();
    });

    it("clears both storage keys together", () => {
      localStorage.setItem("remitlend-user", '{"name":"test"}');
      localStorage.setItem("remitlend-wallet", '{"address":"0x123"}');

      clearSessionState();

      expect(localStorage.getItem("remitlend-user")).toBeNull();
      expect(localStorage.getItem("remitlend-wallet")).toBeNull();
    });
  });

  describe("logoutUser", () => {
    it("clears session state before logout", () => {
      const clearUserMock = vi.fn();
      const disconnectMock = vi.fn();
      vi.mocked(userStore.useUserStore.getState).mockReturnValue({
        clearUser: clearUserMock,
      } as any);
      vi.mocked(walletStore.useWalletStore.getState).mockReturnValue({
        disconnect: disconnectMock,
      } as any);

      logoutUser("manual");

      expect(clearUserMock).toHaveBeenCalled();
      expect(disconnectMock).toHaveBeenCalled();
    });

    it("redirects to home on manual logout", () => {
      const assignMock = vi.fn();
      global.location = { assign: assignMock } as any;

      vi.mocked(userStore.useUserStore.getState).mockReturnValue({
        clearUser: vi.fn(),
      } as any);
      vi.mocked(walletStore.useWalletStore.getState).mockReturnValue({
        disconnect: vi.fn(),
      } as any);

      logoutUser("manual");

      expect(assignMock).toHaveBeenCalledWith("/");
    });

    it("redirects to home on expired logout", () => {
      const assignMock = vi.fn();
      global.location = { assign: assignMock } as any;

      vi.mocked(userStore.useUserStore.getState).mockReturnValue({
        clearUser: vi.fn(),
      } as any);
      vi.mocked(walletStore.useWalletStore.getState).mockReturnValue({
        disconnect: vi.fn(),
      } as any);

      logoutUser("expired");

      expect(assignMock).toHaveBeenCalledWith("/");
    });

    it("debounces logout to prevent multiple redirects", () => {
      const assignMock = vi.fn();
      global.location = { assign: assignMock } as any;

      vi.mocked(userStore.useUserStore.getState).mockReturnValue({
        clearUser: vi.fn(),
      } as any);
      vi.mocked(walletStore.useWalletStore.getState).mockReturnValue({
        disconnect: vi.fn(),
      } as any);

      vi.useFakeTimers();

      logoutUser("manual");
      logoutUser("manual");

      expect(assignMock).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(0);
      vi.useRealTimers();
    });

    it("uses manual logout reason by default", () => {
      const assignMock = vi.fn();
      global.location = { assign: assignMock } as any;

      vi.mocked(userStore.useUserStore.getState).mockReturnValue({
        clearUser: vi.fn(),
      } as any);
      vi.mocked(walletStore.useWalletStore.getState).mockReturnValue({
        disconnect: vi.fn(),
      } as any);

      logoutUser();

      expect(assignMock).toHaveBeenCalledWith("/");
    });
  });

  describe("SessionExpiredError", () => {
    it("is an Error instance", () => {
      const error = new SessionExpiredError();
      expect(error).toBeInstanceOf(Error);
    });

    it("has correct name", () => {
      const error = new SessionExpiredError();
      expect(error.name).toBe("SessionExpiredError");
    });

    it("has default message", () => {
      const error = new SessionExpiredError();
      expect(error.message).toBe("Session expired. Please sign in again.");
    });

    it("accepts custom message", () => {
      const error = new SessionExpiredError("Custom expired message");
      expect(error.message).toBe("Custom expired message");
    });
  });
});
