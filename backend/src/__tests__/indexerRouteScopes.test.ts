import express, { type Express, type Request, type Response } from 'express';
import request from 'supertest';
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

const mockCreateWebhookSubscription = jest.fn((_req: Request, res: Response) => {
  res.status(201).json({ success: true });
});
const mockQuery = jest.fn<(...args: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>>();

const okHandler = (_req: Request, res: Response) => res.json({ success: true });

jest.unstable_mockModule('../controllers/indexerController.js', () => ({
  getIndexerStatus: jest.fn(okHandler),
  getBorrowerEvents: jest.fn(okHandler),
  getLoanEvents: jest.fn(okHandler),
  getRecentEvents: jest.fn(okHandler),
  listWebhookSubscriptions: jest.fn((_req: Request, res: Response) =>
    res.json({ success: true, data: [] }),
  ),
  createWebhookSubscription: mockCreateWebhookSubscription,
  deleteWebhookSubscription: jest.fn(okHandler),
}));

jest.unstable_mockModule('../db/connection.js', () => ({
  withAdvisoryLock: async (_key: string, fn: () => Promise<unknown>) => fn(),
  query: mockQuery,
  default: { query: mockQuery, connect: jest.fn(), end: jest.fn() },
}));

const { default: indexerRoutes } = await import('../routes/indexerRoutes.js');
const { errorHandler } = await import('../middleware/errorHandler.js');

const originalApiKeys = process.env.INTERNAL_API_KEY;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/indexer', indexerRoutes);
  app.use(errorHandler);
  return app;
}

describe('indexer route API key scopes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    process.env.INTERNAL_API_KEY =
      'admin:disputes:dispute-value,admin:webhooks:webhook-value,admin:indexer:indexer-value';
  });

  afterEach(() => {
    if (originalApiKeys === undefined) {
      delete process.env.INTERNAL_API_KEY;
    } else {
      process.env.INTERNAL_API_KEY = originalApiKeys;
    }
  });

  it('rejects a disputes-scoped key on POST /api/indexer/webhooks', async () => {
    await request(buildApp())
      .post('/api/indexer/webhooks')
      .set('x-api-key', 'dispute-value')
      .send({
        callbackUrl: 'https://example.com/webhook',
        eventTypes: ['LoanRequested'],
      })
      .expect(403);

    expect(mockCreateWebhookSubscription).not.toHaveBeenCalled();
  });

  it('allows a webhooks-scoped key on POST /api/indexer/webhooks', async () => {
    await request(buildApp())
      .post('/api/indexer/webhooks')
      .set('x-api-key', 'webhook-value')
      .send({
        callbackUrl: 'https://example.com/webhook',
        eventTypes: ['LoanRequested'],
      })
      .expect(201);

    expect(mockCreateWebhookSubscription).toHaveBeenCalledTimes(1);
  });
});
