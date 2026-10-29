import express, { type Express, type Request, type Response } from 'express';
import request from 'supertest';
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

const okHandler = jest.fn((_req: Request, res: Response) => res.json({ success: true }));
const mockListLoanDisputes = jest.fn(okHandler);
const mockResolveLoanDispute = jest.fn(okHandler);
const mockGetLoanDispute = jest.fn(okHandler);
const mockRejectLoanDispute = jest.fn(okHandler);
const mockGetPendingGovernance = jest.fn(okHandler);
const mockListQuarantinedEvents = jest.fn(okHandler);
const mockListWebhookSubscriptions = jest.fn(okHandler);
const mockCreateWebhookSubscription = jest.fn(okHandler);
const mockDeleteWebhookSubscription = jest.fn(okHandler);
const mockGetWebhookDeliveries = jest.fn(okHandler);
const mockReprocessQuarantinedEvents = jest.fn(okHandler);
const mockReindexLedgerRange = jest.fn(okHandler);
const mockBuildRejectLoanTx = jest.fn(okHandler);
const mockListAuditLogs = jest.fn(okHandler);
const mockCheckOverdueLoans = jest.fn<() => Promise<unknown>>().mockResolvedValue({ checked: 0 });
const mockQuery = jest.fn<(...args: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>>();

jest.unstable_mockModule('../controllers/indexerController.js', () => ({
  createWebhookSubscription: mockCreateWebhookSubscription,
  deleteWebhookSubscription: mockDeleteWebhookSubscription,
  getWebhookDeliveries: mockGetWebhookDeliveries,
  listQuarantinedEvents: mockListQuarantinedEvents,
  listWebhookSubscriptions: mockListWebhookSubscriptions,
  reprocessQuarantinedEvents: mockReprocessQuarantinedEvents,
  reindexLedgerRange: mockReindexLedgerRange,
}));
jest.unstable_mockModule('../controllers/adminDisputeController.js', () => ({
  getLoanDispute: mockGetLoanDispute,
  listLoanDisputes: mockListLoanDisputes,
  rejectLoanDispute: mockRejectLoanDispute,
  resolveLoanDispute: mockResolveLoanDispute,
}));
jest.unstable_mockModule('../controllers/adminGovernanceController.js', () => ({
  getPendingGovernance: mockGetPendingGovernance,
}));
jest.unstable_mockModule('../controllers/loanController.js', () => ({
  buildRejectLoanTx: mockBuildRejectLoanTx,
}));
jest.unstable_mockModule('../controllers/authController.js', () => ({
  listAuditLogs: mockListAuditLogs,
}));
jest.unstable_mockModule('../services/defaultChecker.js', () => ({
  defaultChecker: { checkOverdueLoans: mockCheckOverdueLoans },
}));
jest.unstable_mockModule('../db/connection.js', () => ({
  query: mockQuery,
  default: { query: mockQuery, connect: jest.fn(), end: jest.fn() },
}));

const { default: adminRoutes } = await import('../routes/adminRoutes.js');
const { errorHandler } = await import('../middleware/errorHandler.js');

const originalApiKeys = process.env.INTERNAL_API_KEY;
const scopedKeys = {
  'admin:disputes': 'disputes-key',
  'admin:loans': 'loans-key',
  'admin:indexer': 'indexer-key',
  'admin:webhooks': 'webhooks-key',
} as const;
type AdminScope = keyof typeof scopedKeys;

const buildApp = (): Express => {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRoutes);
  app.use(errorHandler);
  return app;
};

const scopedRoutes: Array<{
  scope: AdminScope;
  method: 'get' | 'post';
  path: string;
  body?: Record<string, unknown>;
  handler: jest.Mock;
}> = [
  {
    scope: 'admin:disputes',
    method: 'get',
    path: '/loan-disputes',
    handler: mockListLoanDisputes,
  },
  {
    scope: 'admin:loans',
    method: 'post',
    path: '/check-defaults',
    body: {},
    handler: mockCheckOverdueLoans,
  },
  {
    scope: 'admin:indexer',
    method: 'get',
    path: '/quarantine-events',
    handler: mockListQuarantinedEvents,
  },
  {
    scope: 'admin:webhooks',
    method: 'get',
    path: '/webhooks',
    handler: mockListWebhookSubscriptions,
  },
];

describe('admin route API key scopes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    mockCheckOverdueLoans.mockResolvedValue({ checked: 0 });
    process.env.INTERNAL_API_KEY = Object.entries(scopedKeys)
      .map(([scope, key]) => `${scope}:${key}`)
      .join(',');
  });

  afterEach(() => {
    if (originalApiKeys === undefined) {
      delete process.env.INTERNAL_API_KEY;
    } else {
      process.env.INTERNAL_API_KEY = originalApiKeys;
    }
  });

  it.each(scopedRoutes)('$scope grants access to $method $path', async (route) => {
    const response = await request(buildApp())
      [route.method](`/api/admin${route.path}`)
      .set('x-api-key', scopedKeys[route.scope])
      .send(route.body ?? {});

    expect(response.status).toBe(200);
    expect(route.handler).toHaveBeenCalledTimes(1);
  });

  it.each(
    scopedRoutes.flatMap((route) =>
      Object.keys(scopedKeys)
        .filter((scope) => scope !== route.scope)
        .map((scope) => ({ route, providedScope: scope as AdminScope })),
    ),
  )('$providedScope cannot access $route.method $route.path', async ({ route, providedScope }) => {
    const response = await request(buildApp())
      [route.method](`/api/admin${route.path}`)
      .set('x-api-key', scopedKeys[providedScope])
      .send(route.body ?? {});

    expect(response.status).toBe(403);
    expect(route.handler).not.toHaveBeenCalled();
  });

  it.each(scopedRoutes)('requires a key for $method $path', async (route) => {
    const response = await request(buildApp())
      [route.method](`/api/admin${route.path}`)
      .send(route.body ?? {});

    expect(response.status).toBe(401);
    expect(route.handler).not.toHaveBeenCalled();
  });

  it.each([
    { method: 'put', path: '/webhooks', key: 'admin:webhooks' },
    { method: 'delete', path: '/quarantine-events', key: 'admin:indexer' },
    { method: 'get', path: '/check-defaults', key: 'admin:loans' },
    { method: 'patch', path: '/loan-disputes', key: 'admin:disputes' },
  ] as const)(
    'does not expose $method $path as an alternate route',
    async ({ method, path, key }) => {
      const response = await request(buildApp())
        [method](`/api/admin${path}`)
        .set('x-api-key', scopedKeys[key]);

      expect(response.status).toBe(404);
      expect(mockListWebhookSubscriptions).not.toHaveBeenCalled();
      expect(mockListQuarantinedEvents).not.toHaveBeenCalled();
      expect(mockCheckOverdueLoans).not.toHaveBeenCalled();
      expect(mockListLoanDisputes).not.toHaveBeenCalled();
    },
  );
});
