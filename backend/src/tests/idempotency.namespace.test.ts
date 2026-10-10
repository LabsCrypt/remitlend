import { Request, Response, NextFunction } from 'express';
import {
  idempotencyMiddleware,
  computeFingerprint,
  namespacedKey,
} from '../middleware/idempotency.js';
import { cacheService } from '../services/cacheService.js';
import { jest } from '@jest/globals';

const asMock = (fn: unknown) => fn as jest.Mock;

const ALICE = 'GBD_ALICE_WALLET';
const BOB = 'GBD_BOB_WALLET';

/**
 * A real namespaced store keyed by the exact cache key the middleware builds,
 * so an entry written under one wallet's namespace is invisible to another's.
 * A mock that returns the same value for every key cannot model isolation.
 */
const store = new Map<string, unknown>();

/**
 * Idempotency keys are client-chosen, so a cache key built from the raw header
 * is shared by every user (#1809). These tests pin the per-wallet namespacing
 * that stops one caller colliding with, or reading back, another's key.
 */
describe('idempotencyMiddleware key namespacing (#1809)', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: NextFunction;

  const buildRequest = (publicKey: string | undefined, key = 'shared-key') => {
    const request: Partial<Request> = {
      header: jest.fn().mockReturnValue(key) as unknown as Request['header'],
      method: 'POST',
      originalUrl: '/api/loans/repay',
      path: '/api/loans/repay',
      baseUrl: '',
      body: { loanId: 7, amount: 100 },
    };
    if (publicKey) {
      (request as Request & { user?: unknown }).user = { publicKey };
    }
    return request;
  };

  const aliceCacheKey = `idemp:${ALICE}:shared-key`;
  const aliceLockKey = `idemp:${ALICE}:shared-key:lock`;
  const bobCacheKey = `idemp:${BOB}:shared-key`;
  const bobLockKey = `idemp:${BOB}:shared-key:lock`;

  const cacheKeysRead = () => asMock(cacheService.get).mock.calls.map(([key]) => String(key));

  beforeEach(() => {
    req = buildRequest(ALICE);
    res = {
      status: jest.fn().mockReturnThis() as unknown as Response['status'],
      set: jest.fn().mockReturnThis() as unknown as Response['set'],
      json: jest.fn().mockReturnThis() as unknown as Response['json'],
      send: jest.fn().mockReturnThis() as unknown as Response['send'],
      on: jest.fn() as unknown as Response['on'],
      statusCode: 201,
    };
    next = jest.fn();

    store.clear();

    // Key-aware in-memory cache: get/set/setNotExists/delete all operate on the
    // same store, keyed by the full cache key (namespace included).
    jest
      .spyOn(cacheService, 'get')
      .mockReset()
      .mockImplementation((async (key: string) => store.get(key) ?? null) as never);
    jest
      .spyOn(cacheService, 'set')
      .mockReset()
      .mockImplementation((async (key: string, value: unknown) => {
        store.set(key, value);
      }) as never);
    jest
      .spyOn(cacheService, 'setNotExists')
      .mockReset()
      .mockImplementation((async (key: string) => {
        if (store.has(key)) return false;
        store.set(key, { lockedAt: Date.now() });
        return true;
      }) as never);
    jest
      .spyOn(cacheService, 'delete')
      .mockReset()
      .mockImplementation((async (key: string) => {
        store.delete(key);
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('namespacedKey', () => {
    it('keeps two actors apart for the same client key', () => {
      expect(namespacedKey(ALICE, 'k')).not.toBe(namespacedKey(BOB, 'k'));
    });

    it('is stable for the same actor and key', () => {
      expect(namespacedKey(ALICE, 'k')).toBe(namespacedKey(ALICE, 'k'));
    });
  });

  describe('cross-user isolation', () => {
    it('reads a different cache key for a different wallet', async () => {
      await idempotencyMiddleware(req as Request, res as Response, next);
      const aliceKey = cacheKeysRead()[0];

      jest.clearAllMocks();
      asMock(cacheService.setNotExists).mockResolvedValue(true);
      await idempotencyMiddleware(buildRequest(BOB) as Request, res as Response, next);
      const bobKey = cacheKeysRead()[0];

      expect(aliceKey).not.toBe(bobKey);
      expect(aliceKey).toContain(ALICE);
      expect(bobKey).toContain(BOB);
    });

    it('does not replay another wallet’s cached response', async () => {
      // Bob's response is already cached under his namespace…
      const bobFingerprint = computeFingerprint(buildRequest(BOB) as Request).fingerprint;
      const bobCacheKey = `idemp:${BOB}:shared-key`;

      // Mock cacheService.get to return Bob's response ONLY for Bob's key
      asMock(cacheService.get).mockImplementation((key: string) => {
        if (key === bobCacheKey) {
          return Promise.resolve({
            status: 201,
            body: { id: 'bob-loan' },
            fingerprint: bobFingerprint,
          });
        }
        return Promise.resolve(null); // Alice's key -> cache miss
      });

      // Save reference to original json mock before middleware overrides it
      const jsonMock = asMock(res.json);

      // …so Alice sending the identical key, path and body gets a cache miss
      // and runs the handler instead of receiving Bob's response. On the
      // handler path the middleware wraps res.json, so the replay assertion
      // targets the original res.json mock captured beforehand: the wrapper
      // delegates to it, making it the recorder of every body the response
      // actually carried.
      const originalJson = res.json as jest.Mock;
      await idempotencyMiddleware(req as Request, res as Response, next);

      expect(cacheKeysRead()[0]).not.toContain('bob-loan');
      expect(jsonMock).not.toHaveBeenCalledWith({ id: 'bob-loan' });
    });

    it('does not reject a user with 409 because another user holds the key', async () => {
      // Bob's in-flight lock is held under his namespace.
      const bobLockKey = `idemp:${BOB}:shared-key:lock`;

      asMock(cacheService.get).mockResolvedValue(null);
      // Mock setNotExists to return false ONLY for Bob's lock key
      asMock(cacheService.setNotExists).mockImplementation((key: string) => {
        if (key === bobLockKey) {
          return Promise.resolve(false); // Bob's lock is held
        }
        return Promise.resolve(true); // Alice can acquire lock
      });

      await idempotencyMiddleware(req as Request, res as Response, next);

      // Alice is unaffected by Bob's lock: her lock acquisition succeeds under
      // her own namespace and the handler still runs.
      expect(asMock(cacheService.setNotExists).mock.calls[0][0]).toBe(
        `idemp:${namespacedKey(ALICE, 'shared-key')}:lock`,
      );
      expect(asMock(res.status)).not.toHaveBeenCalledWith(409);
      expect(next).toHaveBeenCalled();
    });

    it('namespaces the lock key as well as the cache key', async () => {
      // Use the beforeEach mock which returns true for Alice's lock key
      await idempotencyMiddleware(req as Request, res as Response, next);

      const lockKey = asMock(cacheService.setNotExists).mock.calls[0][0];
      expect(String(lockKey)).toContain(ALICE);
      expect(String(lockKey)).toContain(':lock');
    });
  });

  describe('same-wallet behaviour is preserved', () => {
    it('replays the cached response for the same wallet, key and request', async () => {
      asMock(cacheService.get).mockResolvedValue({
        status: 200,
        body: { ok: true },
        fingerprint: computeFingerprint(req as Request).fingerprint,
      });

      await idempotencyMiddleware(req as Request, res as Response, next);

      expect(res.set).toHaveBeenCalledWith('X-Idempotent-Replayed', 'true');
      expect(next).not.toHaveBeenCalled();
    });

    it('still rejects a same-wallet key reused for a different body', async () => {
      asMock(cacheService.get).mockResolvedValue({
        status: 200,
        body: { ok: true },
        fingerprint: 'POST /api/loans/repay#deadbeef',
      });

      await idempotencyMiddleware(req as Request, res as Response, next);

      expect(asMock(res.status)).toHaveBeenCalledWith(409);
    });

    it('executes the handler on a fresh key for the same wallet', async () => {
      asMock(cacheService.setNotExists).mockResolvedValue(true);

      await idempotencyMiddleware(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('unauthenticated requests', () => {
    it('falls back to a shared anon namespace', () => {
      const request = buildRequest(undefined) as Request;
      expect(computeFingerprint(request).actor).toBe('anon');
    });

    it('is stable for repeated anonymous requests', async () => {
      const anonymous = buildRequest(undefined) as Request;
      await idempotencyMiddleware(anonymous, res as Response, next);
      const first = cacheKeysRead()[0];

      jest.clearAllMocks();
      asMock(cacheService.setNotExists).mockResolvedValue(true);
      await idempotencyMiddleware(buildRequest(undefined) as Request, res as Response, next);

      expect(cacheKeysRead()[0]).toBe(first);
      expect(first).toContain('anon');
    });
  });

  describe('computeFingerprint', () => {
    it('reports the wallet as the actor', () => {
      expect(computeFingerprint(req as Request).actor).toBe(ALICE);
    });

    it('keeps the request fingerprint itself unchanged by namespacing', () => {
      const alice = computeFingerprint(buildRequest(ALICE) as Request);
      const bob = computeFingerprint(buildRequest(BOB) as Request);

      // Identical request, different caller: same fingerprint, different actor.
      expect(alice.fingerprint).toBe(bob.fingerprint);
      expect(alice.actor).not.toBe(bob.actor);
    });
  });
});
