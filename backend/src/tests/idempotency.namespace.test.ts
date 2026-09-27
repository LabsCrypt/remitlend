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

    jest.spyOn(cacheService, 'get').mockReset().mockResolvedValue(null);
    jest.spyOn(cacheService, 'set').mockReset().mockResolvedValue(undefined);
    jest.spyOn(cacheService, 'setNotExists').mockReset().mockResolvedValue(true);
    jest.spyOn(cacheService, 'delete').mockReset().mockResolvedValue(undefined);
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
      // Hold the original mock up front: the middleware replaces res.json with
      // a capture shim on a miss and replays through it on a hit.
      const json = asMock(res.json);

      // Let the middleware reveal which slot Bob's request addresses…
      asMock(cacheService.get).mockResolvedValue(null);
      await idempotencyMiddleware(buildRequest(BOB) as Request, res as Response, next);
      const bobCacheKey = cacheKeysRead()[0];

      // …then seed that slot with Bob's response the way a real cache holds it,
      // so the test regresses if the key is ever un-namespaced again: with a
      // shared `idemp:${key}` slot Alice would look up Bob's entry here.
      const store = new Map<string, unknown>([
        [
          bobCacheKey,
          {
            status: 201,
            body: { id: 'bob-loan' },
            fingerprint: computeFingerprint(buildRequest(BOB) as Request).fingerprint,
          },
        ],
      ]);
      jest.clearAllMocks();
      asMock(cacheService.get).mockImplementation((cacheKey: string) =>
        Promise.resolve((store.get(String(cacheKey)) ?? null) as never),
      );
      asMock(cacheService.setNotExists).mockResolvedValue(true);

      // Alice sends the identical key, path and body, so the only thing that
      // can keep her out of Bob's slot is the namespace in the key.
      await idempotencyMiddleware(req as Request, res as Response, next);

      expect(cacheKeysRead()[0]).not.toBe(bobCacheKey);
      expect(json).not.toHaveBeenCalledWith({ id: 'bob-loan' });
      expect(next).toHaveBeenCalled();
    });

    it('does not reject a user with 409 because another user holds the key', async () => {
      // Bob's in-flight lock is held under his namespace only.
      asMock(cacheService.get).mockResolvedValue(null);
      asMock(cacheService.setNotExists).mockImplementation((lockKey: string) =>
        Promise.resolve(!String(lockKey).includes(BOB)),
      );

      await idempotencyMiddleware(req as Request, res as Response, next);

      // Alice is unaffected by Bob's lock: the handler still runs.
      expect(asMock(res.status)).not.toHaveBeenCalledWith(409);
      expect(next).toHaveBeenCalled();
    });

    it('namespaces the lock key as well as the cache key', async () => {
      asMock(cacheService.setNotExists).mockResolvedValue(false);

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
