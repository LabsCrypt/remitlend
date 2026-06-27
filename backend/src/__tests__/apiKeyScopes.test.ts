import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import type { Request, Response, NextFunction } from "express";

/**
 * Unit tests for the scoped requireApiKey middleware.
 * Covers:
 *   - legacy key (no scope prefix) accepted on any route
 *   - scoped key accepted on matching route
 *   - scoped key rejected on different route (403 / 401)
 *   - missing key rejected (401)
 *   - unconfigured INTERNAL_API_KEY throws internal error
 */

const originalEnv = process.env.INTERNAL_API_KEY;

function makeReq(apiKey?: string): Partial<Request> {
  return {
    headers: apiKey ? { "x-api-key": apiKey } : {},
  };
}

function makeRes(): Partial<Response> {
  return {};
}

function makeNext(): NextFunction & { calls: unknown[][] } {
  const fn = ((err?: unknown) => {
    fn.calls.push([err]);
  }) as NextFunction & { calls: unknown[][] };
  fn.calls = [];
  return fn;
}

async function loadMiddleware() {
  // Force module re-evaluation so env changes take effect
  const mod = await import("../middleware/auth.js");
  return mod.requireApiKey;
}

describe("requireApiKey – scope support", () => {
  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.INTERNAL_API_KEY;
    } else {
      process.env.INTERNAL_API_KEY = originalEnv;
    }
  });

  describe("legacy key (no scope)", () => {
    beforeEach(() => {
      process.env.INTERNAL_API_KEY = "legacysecret";
    });

    it("is accepted on a route with no required scope", async () => {
      const requireApiKey = await loadMiddleware();
      const next = makeNext();
      requireApiKey()(
        makeReq("legacysecret") as Request,
        makeRes() as Response,
        next,
      );
      expect(next.calls.length).toBe(1);
      expect(next.calls[0]![0]).toBeUndefined();
    });

    it("is accepted on a route with admin:disputes scope", async () => {
      const requireApiKey = await loadMiddleware();
      const next = makeNext();
      requireApiKey("admin:disputes")(
        makeReq("legacysecret") as Request,
        makeRes() as Response,
        next,
      );
      expect(next.calls.length).toBe(1);
      expect(next.calls[0]![0]).toBeUndefined();
    });

    it("is accepted on any admin scope (admin:loans)", async () => {
      const requireApiKey = await loadMiddleware();
      const next = makeNext();
      requireApiKey("admin:loans")(
        makeReq("legacysecret") as Request,
        makeRes() as Response,
        next,
      );
      expect(next.calls.length).toBe(1);
      expect(next.calls[0]![0]).toBeUndefined();
    });
  });

  describe("scoped key", () => {
    beforeEach(() => {
      // Configure a scoped key for disputes
      process.env.INTERNAL_API_KEY = "admin:disputes:disputesecret";
    });

    it("is accepted on a matching scope", async () => {
      const requireApiKey = await loadMiddleware();
      const next = makeNext();
      requireApiKey("admin:disputes")(
        makeReq("disputesecret") as Request,
        makeRes() as Response,
        next,
      );
      expect(next.calls.length).toBe(1);
      expect(next.calls[0]![0]).toBeUndefined();
    });

    it("throws on a different scope (admin:loans)", async () => {
      const requireApiKey = await loadMiddleware();
      const next = makeNext();
      expect(() =>
        requireApiKey("admin:loans")(
          makeReq("disputesecret") as Request,
          makeRes() as Response,
          next,
        ),
      ).toThrow();
    });

    it("throws when key is absent", async () => {
      const requireApiKey = await loadMiddleware();
      const next = makeNext();
      expect(() =>
        requireApiKey("admin:disputes")(
          makeReq() as Request,
          makeRes() as Response,
          next,
        ),
      ).toThrow();
    });
  });

  describe("multiple keys configured", () => {
    beforeEach(() => {
      process.env.INTERNAL_API_KEY =
        "admin:disputes:sec1,admin:indexer:sec2,legacysecret";
    });

    it("accepts sec1 for admin:disputes", async () => {
      const requireApiKey = await loadMiddleware();
      const next = makeNext();
      requireApiKey("admin:disputes")(
        makeReq("sec1") as Request,
        makeRes() as Response,
        next,
      );
      expect(next.calls[0]![0]).toBeUndefined();
    });

    it("accepts sec2 for admin:indexer", async () => {
      const requireApiKey = await loadMiddleware();
      const next = makeNext();
      requireApiKey("admin:indexer")(
        makeReq("sec2") as Request,
        makeRes() as Response,
        next,
      );
      expect(next.calls[0]![0]).toBeUndefined();
    });

    it("rejects sec1 for admin:indexer", async () => {
      const requireApiKey = await loadMiddleware();
      const next = makeNext();
      expect(() =>
        requireApiKey("admin:indexer")(
          makeReq("sec1") as Request,
          makeRes() as Response,
          next,
        ),
      ).toThrow();
    });

    it("accepts legacy key for admin:webhooks", async () => {
      const requireApiKey = await loadMiddleware();
      const next = makeNext();
      requireApiKey("admin:webhooks")(
        makeReq("legacysecret") as Request,
        makeRes() as Response,
        next,
      );
      expect(next.calls[0]![0]).toBeUndefined();
    });
  });

  describe("constant-time comparison", () => {
    beforeEach(() => {
      process.env.INTERNAL_API_KEY = "correctsecret";
    });

    it("rejects a wrong key that has the same length as the correct key", async () => {
      const requireApiKey = await loadMiddleware();
      const next = makeNext();
      // "wrongsecreXX" has same byte-length as "correctsecret" (13 chars)
      expect(() =>
        requireApiKey()(
          makeReq("wrongsecretXX") as Request,
          makeRes() as Response,
          next,
        ),
      ).toThrow();
      expect(next.calls.length).toBe(0);
    });
  });

  describe("INTERNAL_API_KEY not set", () => {
    beforeEach(() => {
      delete process.env.INTERNAL_API_KEY;
    });

    it("throws an internal error", async () => {
      const requireApiKey = await loadMiddleware();
      const next = makeNext();
      expect(() =>
        requireApiKey()(
          makeReq("anykey") as Request,
          makeRes() as Response,
          next,
        ),
      ).toThrow();
    });
  });
});
