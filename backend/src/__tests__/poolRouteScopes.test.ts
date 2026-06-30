/**
 * Issue #1179: Integration tests that exercise pool write route authorization
 * at the route layer (through app.use) so the requireScopes middleware is
 * actually exercised.
 *
 * The lender role in rbac.ts only grants read:pool, NOT write:pool, so all
 * pool write routes (build-deposit, build-withdraw, build-emergency-withdraw,
 * submit) must return 403 for a lender JWT.  A borrower JWT must also be
 * rejected because borrowers lack even read:pool.
 */

import { describe, it, expect } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../app.js';

// Sign with the same secret jwtAuth verifies against; falls back to a fixed
// value if env wasn't loaded so the test doesn't silently sign an HS256
// payload that the middleware can't decode.
const JWT_SECRET = process.env.JWT_SECRET ?? 'test-jwt-secret-poolscopes';

function mintToken(
  publicKey: string,
  role: 'lender' | 'borrower' | 'admin',
  scopes: string[],
): string {
  return jwt.sign({ publicKey, role, scopes }, JWT_SECRET, {
    expiresIn: '1h',
    algorithm: 'HS256',
  });
}

const LENDER_KEY = 'GLENDER000000000000000000000000000000000000000000000000001';
const BORROWER_KEY = 'GBORROWER0000000000000000000000000000000000000000000000001';

// lender has read:pool but NOT write:pool — as per ROLE_SCOPES in rbac.ts
const lenderToken = mintToken(LENDER_KEY, 'lender', ['read:loans', 'read:pool']);
// borrower has no pool scopes at all
const borrowerToken = mintToken(BORROWER_KEY, 'borrower', [
  'read:loans',
  'write:repayment',
  'read:score',
  'read:notifications',
  'write:notifications',
]);

const POOL_WRITE_ROUTES: Array<{ method: 'post'; path: string; body: Record<string, unknown> }> = [
  {
    method: 'post',
    path: '/api/pool/build-deposit',
    body: { depositorPublicKey: LENDER_KEY, token: 'GTOKEN', amount: 100 },
  },
  {
    method: 'post',
    path: '/api/pool/build-withdraw',
    body: { depositorPublicKey: LENDER_KEY, token: 'GTOKEN', amount: 100 },
  },
  {
    method: 'post',
    path: '/api/pool/build-emergency-withdraw',
    body: { depositorPublicKey: LENDER_KEY, token: 'GTOKEN', shares: 100 },
  },
  {
    method: 'post',
    path: '/api/pool/submit',
    body: { signedTxXdr: 'AAAA' },
  },
];

beforeAll(() => {
  process.env.JWT_SECRET = JWT_SECRET;
});

describe('Pool write route authorization (#1179)', () => {
  describe('lender JWT (has read:pool, missing write:pool)', () => {
    for (const route of POOL_WRITE_ROUTES) {
      it(`${route.method.toUpperCase()} ${route.path} → 403`, async () => {
        const res = await request(app)
          [route.method](route.path)
          .set('Authorization', `Bearer ${lenderToken}`)
          .send(route.body);

        expect(res.status).toBe(403);
      });
    }
  });

  describe('borrower JWT (no pool scopes at all)', () => {
    for (const route of POOL_WRITE_ROUTES) {
      it(`${route.method.toUpperCase()} ${route.path} → 403`, async () => {
        const res = await request(app)
          [route.method](route.path)
          .set('Authorization', `Bearer ${borrowerToken}`)
          .send(route.body);

        // borrower also fails requireLender (role check) before even reaching
        // requireScopes — expect 403 either way
        expect(res.status).toBe(403);
      });
    }
  });

  describe('no JWT', () => {
    for (const route of POOL_WRITE_ROUTES) {
      it(`${route.method.toUpperCase()} ${route.path} → 401`, async () => {
        const res = await request(app)[route.method](route.path).send(route.body);

        expect(res.status).toBe(401);
      });
    }
  });

  describe('pool read routes are accessible with lender JWT (read:pool)', () => {
    it('GET /api/pool/stats → not 403 (auth passes, may fail for other reasons)', async () => {
      const res = await request(app)
        .get('/api/pool/stats')
        .set('Authorization', `Bearer ${lenderToken}`);

      // Auth layer passes (not 401/403) — downstream may 500 without DB
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });

    it('borrower JWT on GET /api/pool/stats → 403 (requireLender)', async () => {
      const res = await request(app)
        .get('/api/pool/stats')
        .set('Authorization', `Bearer ${borrowerToken}`);

      expect(res.status).toBe(403);
    });
  });
});
