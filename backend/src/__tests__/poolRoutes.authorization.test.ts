import express from 'express';
import request from 'supertest';
import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';

const LENDER_KEY = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const ADMIN_KEY = 'GCWEPACYJLN7S3ZUXSVMXZBFKYXSHRGZ6O326HDDPDKBKZPXD45XNHC3';
const OTHER_KEY = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
const JWT_SECRET = 'test-jwt-secret-pool-routes';

process.env.JWT_SECRET = JWT_SECRET;
process.env.LENDER_WALLETS = LENDER_KEY;
process.env.ADMIN_WALLETS = ADMIN_KEY;

const mockQuery = jest.fn<(...args: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>>();
const mockBuildWithdrawTx =
  jest.fn<
    (
      depositorPublicKey: string,
      token: string,
      amount: number,
      minAssetsOut: number,
    ) => Promise<{ unsignedTxXdr: string; networkPassphrase: string }>
  >();
const mockBuildEmergencyWithdrawTx =
  jest.fn<
    (
      depositorPublicKey: string,
      token: string,
      shares: number,
      minAssetsOut: number,
    ) => Promise<{ unsignedTxXdr: string; networkPassphrase: string }>
  >();
const mockSubmitSignedTx =
  jest.fn<(signedTxXdr: string) => Promise<{ txHash: string; status: string }>>();
const mockWithStellarAndDbTransaction = jest.fn(
  async (stellarOperation: () => Promise<unknown>) => ({
    stellarResult: await stellarOperation(),
  }),
);

jest.unstable_mockModule('../db/connection.js', () => ({
  query: mockQuery,
  default: { query: mockQuery },
}));

jest.unstable_mockModule('../db/transaction.js', () => ({
  withStellarAndDbTransaction: mockWithStellarAndDbTransaction,
}));

jest.unstable_mockModule('../services/cacheService.js', () => ({
  cacheService: {
    get: jest.fn<() => Promise<null>>().mockResolvedValue(null),
    delete: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  },
}));

jest.unstable_mockModule('../services/sorobanService.js', () => ({
  sorobanService: {
    buildWithdrawTx: mockBuildWithdrawTx,
    buildEmergencyWithdrawTx: mockBuildEmergencyWithdrawTx,
    submitSignedTx: mockSubmitSignedTx,
  },
}));

const { default: poolRoutes } = await import('../routes/poolRoutes.js');
const { errorHandler } = await import('../middleware/errorHandler.js');
const { pauseGuard, setPauseState } = await import('../middleware/pauseGuard.js');

const app = express();
app.use(express.json());
app.use(pauseGuard);
app.use('/api/pool', poolRoutes);
app.use(errorHandler);

const token = (publicKey: string): string => {
  const scopes = publicKey === ADMIN_KEY ? ['admin:all'] : ['read:pool'];
  return jwt.sign({ publicKey, role: 'unused', scopes, jti: 'pool-route-test' }, JWT_SECRET, {
    expiresIn: '1h',
    algorithm: 'HS256',
  });
};

const lenderToken = token(LENDER_KEY);
const adminToken = token(ADMIN_KEY);

beforeEach(async () => {
  jest.clearAllMocks();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
  mockBuildWithdrawTx.mockResolvedValue({
    unsignedTxXdr: 'unsigned-withdraw-xdr',
    networkPassphrase: 'test-network',
  });
  mockBuildEmergencyWithdrawTx.mockResolvedValue({
    unsignedTxXdr: 'unsigned-emergency-withdraw-xdr',
    networkPassphrase: 'test-network',
  });
  mockSubmitSignedTx.mockResolvedValue({ txHash: 'pool-transaction-hash', status: 'SUCCESS' });
  await setPauseState(false, []);
});

describe('pool route authorization', () => {
  it('allows a lender to read their own depositor portfolio', async () => {
    const response = await request(app)
      .get(`/api/pool/depositor/${LENDER_KEY}`)
      .set('Authorization', `Bearer ${lenderToken}`)
      .send();

    expect(response.status).toBe(200);
    expect(response.body.data.address).toBe(LENDER_KEY);
  });

  it('rejects a lender reading another depositor portfolio', async () => {
    const response = await request(app)
      .get(`/api/pool/depositor/${OTHER_KEY}`)
      .set('Authorization', `Bearer ${lenderToken}`)
      .send();

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      success: false,
      message: 'You are not authorized to access this resource',
      error: {
        code: 'FORBIDDEN',
        message: 'You are not authorized to access this resource',
      },
    });
    expect(mockBuildWithdrawTx).not.toHaveBeenCalled();
  });

  it('rejects an admin building a withdrawal for another wallet', async () => {
    const response = await request(app)
      .post('/api/pool/build-withdraw')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ depositorPublicKey: OTHER_KEY, token: LENDER_KEY, amount: 100 });

    expect(response.status).toBe(403);
    expect(response.body.message).toBe('depositorPublicKey must match your authenticated wallet');
    expect(mockBuildWithdrawTx).not.toHaveBeenCalled();
  });

  it.each([
    {
      path: '/api/pool/build-withdraw',
      body: { depositorPublicKey: ADMIN_KEY, token: OTHER_KEY, amount: 100 },
    },
    {
      path: '/api/pool/build-emergency-withdraw',
      body: { depositorPublicKey: ADMIN_KEY, token: OTHER_KEY, shares: 100 },
    },
    { path: '/api/pool/submit', body: { signedTxXdr: 'cG9vbC10eA==' } },
  ])('allows an admin to use the privileged route $path', async ({ path, body }) => {
    const response = await request(app)
      .post(path)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  it('rejects pool writes while paused with the public service-unavailable contract', async () => {
    await setPauseState(true, ['LENDING_POOL'], 'security incident');

    const response = await request(app)
      .post('/api/pool/build-withdraw')
      .set('Authorization', `Bearer ${lenderToken}`)
      .send({ depositorPublicKey: LENDER_KEY, token: OTHER_KEY, amount: 100 });

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      success: false,
      message:
        'Contract operations are temporarily paused. Reason: security incident. Affected contracts: LENDING_POOL',
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message:
          'Contract operations are temporarily paused. Reason: security incident. Affected contracts: LENDING_POOL',
      },
    });
    expect(mockBuildWithdrawTx).not.toHaveBeenCalled();
  });
});
