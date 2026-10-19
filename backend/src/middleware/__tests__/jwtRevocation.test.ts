import { jest, describe, it, expect, beforeEach, beforeAll } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import { Keypair } from '@stellar/stellar-sdk';

process.env.JWT_SECRET = 'test-jwt-secret-min-32-chars-long!!';

// In-memory fake cache so revokeToken/isTokenRevoked actually persist state
// across requests within a test, the same way a real Redis blacklist would.
const fakeCacheStore = new Map<string, unknown>();
jest.unstable_mockModule('../../services/cacheService.js', () => ({
  cacheService: {
    get: jest.fn(async (key: string) => fakeCacheStore.get(key) ?? null),
    set: jest.fn(async (key: string, value: unknown) => {
      fakeCacheStore.set(key, value);
    }),
    delete: jest.fn(async (key: string) => {
      fakeCacheStore.delete(key);
    }),
  },
}));

const { generateJwtToken, revokeToken, decodeJwtToken } =
  await import('../../services/authService.js');
const { requireJwtAuth, requireScopes } = await import('../jwtAuth.js');

const buildApp = () => {
  const app = express();
  app.get('/admin-only', requireJwtAuth, requireScopes('admin:all'), (_req, res) =>
    res.status(200).json({ success: true }),
  );
  app.post('/echo', requireJwtAuth, (req, res) =>
    res.status(200).json({
      publicKey: (req as { user?: { publicKey: string } }).user?.publicKey,
    }),
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode ?? 500).json({ success: false });
  });
  return app;
};

describe('JWT revocation and role-change propagation', () => {
  const ORIGINAL_ADMIN_WALLETS = process.env.ADMIN_WALLETS;

  beforeEach(() => {
    fakeCacheStore.clear();
    process.env.ADMIN_WALLETS = ORIGINAL_ADMIN_WALLETS;
  });

  it('rejects a token minted while admin, after the wallet is removed from ADMIN_WALLETS', async () => {
    const wallet = Keypair.random().publicKey();
    process.env.ADMIN_WALLETS = wallet;

    // Minted while the wallet was an admin — embeds scopes: ["admin:all"].
    const token = generateJwtToken(wallet);
    const app = buildApp();

    const beforeRemoval = await request(app)
      .get('/admin-only')
      .set('Authorization', `Bearer ${token}`);
    expect(beforeRemoval.status).toBe(200);

    // Wallet is revoked from the admin allowlist; no new token is issued.
    process.env.ADMIN_WALLETS = '';

    const afterRemoval = await request(app)
      .get('/admin-only')
      .set('Authorization', `Bearer ${token}`);

    expect(afterRemoval.status).toBe(403);
  });

  it("rejects a token immediately after logout, even though its role hasn't changed", async () => {
    const wallet = Keypair.random().publicKey();
    const token = generateJwtToken(wallet);
    const payload = decodeJwtToken(token);
    const app = buildApp();

    const beforeLogout = await request(app).post('/echo').set('Authorization', `Bearer ${token}`);
    expect(beforeLogout.status).toBe(200);

    await revokeToken(payload!.jti, payload!.exp);

    const afterLogout = await request(app).post('/echo').set('Authorization', `Bearer ${token}`);
    expect(afterLogout.status).toBe(401);
  });
});

describe('isTokenRevoked fail-closed behavior', () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  beforeAll(() => {
    process.env.NODE_ENV = 'test';
  });

  beforeEach(() => {
    jest.resetModules();
    fakeCacheStore.clear();
  });

  afterAll(() => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  });

  it('returns true (revoked) when cacheService.get rejects', async () => {
    jest.unstable_mockModule('../../services/cacheService.js', () => ({
      cacheService: {
        get: jest.fn(async () => {
          throw new Error('Redis connection failed');
        }),
        set: jest.fn(),
        delete: jest.fn(),
      },
    }));

    // Re-import after mocking
    const { isTokenRevoked: freshIsTokenRevoked } = await import('../../services/authService.js');

    const result = await freshIsTokenRevoked('some-jti');
    expect(result).toBe(true);
  });

  it('returns true (revoked) when cacheService.get times out', async () => {
    jest.unstable_mockModule('../../services/cacheService.js', () => ({
      cacheService: {
        get: jest.fn(async () => {
          // Hang longer than REVOCATION_CHECK_TIMEOUT_MS (250ms)
          await new Promise((resolve) => setTimeout(resolve, 500));
          return null;
        }),
        set: jest.fn(),
        delete: jest.fn(),
      },
    }));

    // Re-import after mocking
    const { isTokenRevoked: freshIsTokenRevoked } = await import('../../services/authService.js');

    const result = await freshIsTokenRevoked('some-jti');
    expect(result).toBe(true);
  });

  it('returns true (revoked) when cacheService.get returns null after timeout', async () => {
    // This tests the race condition where the timeout fires before the cache returns
    let resolveCache: (value: boolean | null) => void;
    const cachePromise = new Promise<boolean | null>((resolve) => {
      resolveCache = resolve;
    });

    jest.unstable_mockModule('../../services/cacheService.js', () => ({
      cacheService: {
        get: jest.fn(async () => cachePromise),
        set: jest.fn(),
        delete: jest.fn(),
      },
    }));

    const { isTokenRevoked: freshIsTokenRevoked } = await import('../../services/authService.js');

    // Start the check, but don't resolve the cache promise yet
    const checkPromise = freshIsTokenRevoked('some-jti');

    // Wait for the timeout to fire (250ms + buffer)
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Now resolve the cache promise - it should be ignored since timeout already fired
    resolveCache!(true);

    const result = await checkPromise;
    expect(result).toBe(true);
  });

  it('returns false (not revoked) when cacheService.get returns null quickly', async () => {
    jest.unstable_mockModule('../../services/cacheService.js', () => ({
      cacheService: {
        get: jest.fn(async () => null),
        set: jest.fn(),
        delete: jest.fn(),
      },
    }));

    const { isTokenRevoked: freshIsTokenRevoked } = await import('../../services/authService.js');

    const result = await freshIsTokenRevoked('some-jti');
    expect(result).toBe(false);
  });

  it('returns true (revoked) when cacheService.get returns true quickly', async () => {
    jest.unstable_mockModule('../../services/cacheService.js', () => ({
      cacheService: {
        get: jest.fn(async () => true),
        set: jest.fn(),
        delete: jest.fn(),
      },
    }));

    const { isTokenRevoked: freshIsTokenRevoked } = await import('../../services/authService.js');

    const result = await freshIsTokenRevoked('some-jti');
    expect(result).toBe(true);
  });
});
