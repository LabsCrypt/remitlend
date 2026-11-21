import { jest, describe, it, expect, afterAll } from '@jest/globals';
import request from 'supertest';
import { Keypair } from '@stellar/stellar-sdk';

process.env.JWT_SECRET = 'test-jwt-secret-min-32-chars-long!!';
const originalTrustProxyHops = process.env.TRUST_PROXY_HOPS;
process.env.TRUST_PROXY_HOPS = '1';

type MockQueryResult = { rows: unknown[]; rowCount: number };

// Mock infrastructure dependencies before importing app
jest.unstable_mockModule('../db/connection.js', () => ({
  default: {
    query: jest.fn<() => Promise<MockQueryResult>>().mockResolvedValue({ rows: [], rowCount: 0 }),
  },
  query: jest.fn<() => Promise<MockQueryResult>>().mockResolvedValue({ rows: [], rowCount: 0 }),
  getClient: jest.fn(),
  withTransaction: jest.fn(),
}));

jest.unstable_mockModule('../services/cacheService.js', () => ({
  cacheService: {
    ping: jest.fn<() => Promise<string>>().mockResolvedValue('ok'),
    get: jest.fn<() => Promise<null>>().mockResolvedValue(null),
    set: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    setNotExists: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
    deleteIfMatch: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
    delete: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  },
}));

jest.unstable_mockModule('../services/sorobanService.js', () => ({
  sorobanService: {
    ping: jest.fn<() => Promise<string>>().mockResolvedValue('ok'),
  },
}));

const { parseTrustProxyHops } = await import('../config/env.js');
const { default: app } = await import('../app.js');

afterAll(() => {
  if (originalTrustProxyHops === undefined) {
    delete process.env.TRUST_PROXY_HOPS;
  } else {
    process.env.TRUST_PROXY_HOPS = originalTrustProxyHops;
  }
});

describe('parseTrustProxyHops', () => {
  it('defaults to 0 when unset or empty', () => {
    expect(parseTrustProxyHops(undefined)).toBe(0);
    expect(parseTrustProxyHops('')).toBe(0);
    expect(parseTrustProxyHops('   ')).toBe(0);
  });

  it('parses valid non-negative integers', () => {
    expect(parseTrustProxyHops('0')).toBe(0);
    expect(parseTrustProxyHops('1')).toBe(1);
    expect(parseTrustProxyHops(' 2 ')).toBe(2);
  });

  it('rejects invalid values', () => {
    expect(() => parseTrustProxyHops('-1')).toThrow(/TRUST_PROXY_HOPS/);
    expect(() => parseTrustProxyHops('true')).toThrow(/TRUST_PROXY_HOPS/);
    expect(() => parseTrustProxyHops('1.5')).toThrow(/TRUST_PROXY_HOPS/);
    expect(() => parseTrustProxyHops('loopback')).toThrow(/TRUST_PROXY_HOPS/);
  });
});

describe('Express trust proxy integration', () => {
  it('configures trust proxy from TRUST_PROXY_HOPS and isolates rate-limit buckets per client behind a proxy', async () => {
    expect(app.get('trust proxy')).toBe(1);

    const badLogin = () => ({
      publicKey: Keypair.random().publicKey(),
      message: `Sign this message to log in. Timestamp: ${Date.now()}`,
      signature: Buffer.alloc(64).toString('base64'),
    });

    // Client A behind a single proxy exhausts its 5 req/min bucket
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/api/auth/login')
        .set('X-Forwarded-For', '198.51.100.1')
        .send(badLogin());
      expect(res.status).toBe(401);
    }

    const blockedRes = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', '198.51.100.1')
      .send(badLogin());
    expect(blockedRes.status).toBe(429);

    // Client B behind the same proxy still has its own independent bucket
    const clientBRes = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', '198.51.100.2')
      .send(badLogin());
    expect(clientBRes.status).toBe(401);
  });
});
