/**
 * lib/session.test.ts
 *
 * Unit tests for session management and JWT expiry helpers.
 */

// Polyfill window environment for non-jsdom runners (e.g. Bun test)
if (typeof window === "undefined") {
  const store: Record<string, string> = {};
  (globalThis as unknown as { window: unknown }).window = {
    atob: (str: string) => Buffer.from(str, "base64").toString("binary"),
    btoa: (str: string) => Buffer.from(str, "binary").toString("base64"),
    localStorage: {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, val: string) => {
        store[key] = String(val);
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        Object.keys(store).forEach((k) => delete store[k]);
      },
    },
    location: {
      assign: () => {},
    },
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  };
}

import { isJwtExpired, clearSessionState, logoutUser, SessionExpiredError } from "./session";
import { useUserStore } from "../stores/useUserStore";
import { useWalletStore } from "../stores/useWalletStore";

function createMockJwt(payload: Record<string, unknown>): string {
  const header = { alg: "HS256", typ: "JWT" };
  const toBase64Url = (obj: Record<string, unknown>): string => {
    const jsonStr = JSON.stringify(obj);
    const base64 = Buffer.from(jsonStr, "utf-8").toString("base64");
    return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };

  return `${toBase64Url(header)}.${toBase64Url(payload)}.mocksignature`;
}

describe("session.ts", () => {
  let assignMock: jest.Mock;
  let originalImplAssign: unknown;

  beforeEach(() => {
    jest.useFakeTimers();

    assignMock = jest.fn();

    const sym = Object.getOwnPropertySymbols(window.location)[0];
    if (sym && (window.location as Record<symbol, unknown>)[sym]) {
      const impl = (window.location as Record<symbol, Record<string, unknown>>)[sym];
      originalImplAssign = impl.assign;
      impl.assign = assignMock;
    } else {
      (window.location as { assign: unknown }).assign = assignMock;
    }

    window.localStorage.clear();

    useUserStore.setState({
      user: null,
      authToken: null,
      isLoading: false,
      error: null,
      isAuthenticated: false,
    });

    useWalletStore.setState({
      status: "disconnected",
      address: null,
      network: null,
      balances: [],
      isLoadingBalances: false,
      error: null,
      shouldAutoReconnect: false,
    });
  });

  afterEach(() => {
    jest.runAllTimers();
    jest.useRealTimers();

    const sym = Object.getOwnPropertySymbols(window.location)[0];
    if (sym && (window.location as Record<symbol, unknown>)[sym] && originalImplAssign) {
      const impl = (window.location as Record<symbol, Record<string, unknown>>)[sym];
      impl.assign = originalImplAssign;
    }
  });

  describe("SessionExpiredError", () => {
    it("creates an instance with default message and name", () => {
      const error = new SessionExpiredError();
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe("SessionExpiredError");
      expect(error.message).toBe("Session expired. Please sign in again.");
    });

    it("creates an instance with a custom message", () => {
      const customMsg = "Custom token expiration notice";
      const error = new SessionExpiredError(customMsg);
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe("SessionExpiredError");
      expect(error.message).toBe(customMsg);
    });
  });

  describe("isJwtExpired", () => {
    it("returns false for a valid non-expired JWT token", () => {
      const futureExp = Math.floor(Date.now() / 1000) + 3600;
      const token = createMockJwt({
        sub: "user-123",
        email: "test@example.com",
        exp: futureExp,
      });

      expect(isJwtExpired(token)).toBe(false);
    });

    it("returns true for an expired JWT token", () => {
      const pastExp = Math.floor(Date.now() / 1000) - 3600;
      const token = createMockJwt({
        sub: "user-123",
        email: "test@example.com",
        exp: pastExp,
      });

      expect(isJwtExpired(token)).toBe(true);
    });

    it("returns true when token exp is exactly the current timestamp", () => {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const token = createMockJwt({
        sub: "user-123",
        exp: nowSeconds,
      });

      expect(isJwtExpired(token)).toBe(true);
    });

    it("correctly handles base64url characters (- and _) and padding", () => {
      const tokenWithBase64UrlChars = createMockJwt({
        sub: "user?special=true&query=1",
        email: "test_user-name@example.com",
        exp: Math.floor(Date.now() / 1000) + 7200,
        extraData: ">>>???---___///",
      });

      expect(isJwtExpired(tokenWithBase64UrlChars)).toBe(false);
    });

    it("returns false for an empty token string", () => {
      expect(isJwtExpired("")).toBe(false);
    });

    it("returns false for a token without dot separators", () => {
      expect(isJwtExpired("rawstringwithoutanydots")).toBe(false);
    });

    it("returns false for a token with empty payload part", () => {
      expect(isJwtExpired("header..signature")).toBe(false);
    });

    it("returns false for a token with undecodable non-base64 payload", () => {
      expect(isJwtExpired("header.!!!not-valid-base64!!!.signature")).toBe(false);
    });

    it("returns false for a token where payload is valid base64 but invalid JSON", () => {
      const rawTextBase64 = Buffer.from("just plain text not json").toString("base64");
      const token = `header.${rawTextBase64}.signature`;
      expect(isJwtExpired(token)).toBe(false);
    });

    it("returns false for a token where payload has no exp claim", () => {
      const tokenWithoutExp = createMockJwt({
        sub: "user-no-exp",
        email: "noexp@example.com",
      });

      expect(isJwtExpired(tokenWithoutExp)).toBe(false);
    });

    it("returns false for a token where exp is not a number", () => {
      const tokenWithStringExp = createMockJwt({
        sub: "user-invalid-exp",
        exp: "9999999999",
      });

      expect(isJwtExpired(tokenWithStringExp)).toBe(false);
    });
  });

  describe("clearSessionState", () => {
    it("clears both user and wallet stores and removes localStorage items", () => {
      useUserStore.getState().setUser({
        id: "user-1",
        email: "alice@example.com",
        kycVerified: true,
      });
      useUserStore.getState().setAuthToken("jwt-token-123");

      useWalletStore.getState().setConnected("0x1234567890abcdef", {
        chainId: 1,
        name: "Ethereum Mainnet",
        isSupported: true,
      });

      window.localStorage.setItem("remitlend-user", JSON.stringify({ user: { id: "user-1" } }));
      window.localStorage.setItem("remitlend-wallet", JSON.stringify({ address: "0x123" }));
      window.localStorage.setItem("unrelated-key", "preserved-value");

      clearSessionState();

      const userState = useUserStore.getState();
      expect(userState.user).toBeNull();
      expect(userState.isAuthenticated).toBe(false);
      expect(userState.authToken).toBeNull();

      const walletState = useWalletStore.getState();
      expect(walletState.status).toBe("disconnected");
      expect(walletState.address).toBeNull();
      expect(walletState.network).toBeNull();

      expect(window.localStorage.getItem("remitlend-user")).toBeNull();
      expect(window.localStorage.getItem("remitlend-wallet")).toBeNull();
      expect(window.localStorage.getItem("unrelated-key")).toBe("preserved-value");
    });

    it("handles already empty stores without throwing", () => {
      expect(() => clearSessionState()).not.toThrow();

      expect(useUserStore.getState().user).toBeNull();
      expect(useWalletStore.getState().address).toBeNull();
    });
  });

  describe("logoutUser", () => {
    it("clears session state and navigates to '/' on manual logout", () => {
      useUserStore.getState().setUser({
        id: "user-manual",
        email: "manual@example.com",
        kycVerified: false,
      });
      window.localStorage.setItem("remitlend-user", "persisted-data");

      logoutUser("manual");

      expect(useUserStore.getState().user).toBeNull();
      expect(window.localStorage.getItem("remitlend-user")).toBeNull();
      expect(assignMock).toHaveBeenCalledTimes(1);
      expect(assignMock).toHaveBeenCalledWith("/");
    });

    it("clears session state and navigates to '/' on expired logout", () => {
      useUserStore.getState().setUser({
        id: "user-expired",
        email: "expired@example.com",
        kycVerified: false,
      });
      window.localStorage.setItem("remitlend-user", "persisted-data");

      logoutUser("expired");

      expect(useUserStore.getState().user).toBeNull();
      expect(window.localStorage.getItem("remitlend-user")).toBeNull();
      expect(assignMock).toHaveBeenCalledTimes(1);
      expect(assignMock).toHaveBeenCalledWith("/");
    });

    it("defaults to manual logout when reason argument is omitted", () => {
      logoutUser();

      expect(assignMock).toHaveBeenCalledTimes(1);
      expect(assignMock).toHaveBeenCalledWith("/");
    });

    it("debounces rapid duplicate calls and prevents duplicate navigation", () => {
      logoutUser("manual");
      logoutUser("manual");
      logoutUser("expired");

      expect(assignMock).toHaveBeenCalledTimes(1);
      expect(assignMock).toHaveBeenCalledWith("/");
    });

    it("allows navigation again after the debounce timer expires", () => {
      logoutUser("manual");
      expect(assignMock).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(1);

      logoutUser("manual");
      expect(assignMock).toHaveBeenCalledTimes(2);
    });
  });
});
