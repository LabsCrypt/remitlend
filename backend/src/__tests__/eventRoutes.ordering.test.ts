/**
 * Ordering, replay-window and payload coverage for eventRoutes (#2105).
 *
 * SSE responses never end, so stream tests use a real server and raw client
 * sockets (same approach as eventStream.success.test.ts). The router is
 * mounted on a bare app so only the event routes and their auth run.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { type Express } from 'express';
import request from 'supertest';
import {
  describe,
  it,
  expect,
  jest,
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
} from '@jest/globals';

jest.setTimeout(15_000);

process.env.JWT_SECRET = 'test-jwt-secret-min-32-chars-long!!';
process.env.INTERNAL_API_KEY = 'admin:indexer:indexer-value,admin:webhooks:webhook-value';
process.env.ADMIN_WALLETS = 'GADMINEVENTORDER';

const BORROWER = 'GBORROWEREVENTORDER';
const ADMIN = 'GADMINEVENTORDER';

type QueryResult = { rows: Record<string, unknown>[]; rowCount?: number };

const mockQuery = jest.fn<(text: string, params?: unknown[]) => Promise<QueryResult>>();
jest.unstable_mockModule('../db/connection.js', () => ({
  withAdvisoryLock: async (_key: string, fn: () => Promise<unknown>) => fn(),
  query: mockQuery,
  getClient: jest.fn(),
  withTransaction: jest.fn(),
  default: { query: mockQuery },
}));

const fakeCacheStore = new Map<string, unknown>();
jest.unstable_mockModule('../services/cacheService.js', () => ({
  cacheService: {
    get: jest.fn(async (key: string) => fakeCacheStore.get(key) ?? null),
    set: jest.fn(async (key: string, value: unknown) => {
      fakeCacheStore.set(key, value);
    }),
    delete: jest.fn(async (key: string) => {
      fakeCacheStore.delete(key);
    }),
    ping: jest.fn(async () => 'ok'),
  },
}));

const { default: eventRoutes } = await import('../routes/eventRoutes.js');
const { errorHandler } = await import('../middleware/errorHandler.js');
const { generateJwtToken } = await import('../services/authService.js');
const { eventStreamService } = await import('../services/eventStreamService.js');

const buildApp = (): Express => {
  const app = express();
  app.use('/api/events', eventRoutes);
  app.use(errorHandler);
  return app;
};

const app = buildApp();

const bearer = (publicKey: string) => ({
  Authorization: `Bearer ${generateJwtToken(publicKey)}`,
});

const eventRow = (id: string, overrides: Record<string, unknown> = {}) => ({
  event_id: id,
  event_type: 'LoanRepaid',
  loan_id: 9,
  address: BORROWER,
  amount: '500',
  ledger: 7000,
  ledger_closed_at: '2026-10-01T00:00:00Z',
  tx_hash: `tx-${id}`,
  ...overrides,
});

// ── Raw SSE client ───────────────────────────────────────────────────────────

interface Stream {
  status: number;
  raw: string;
  destroy: () => void;
}

let server: http.Server;
let baseUrl = '';
const openStreams: Stream[] = [];

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const waitFor = async (predicate: () => boolean, what: string, timeoutMs = 2000): Promise<void> => {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${what}`);
    await sleep(10);
  }
};

const openStream = (path: string, headers: Record<string, string>): Stream => {
  const stream: Stream = { status: 0, raw: '', destroy: () => req.destroy() };
  const req = http.get(`${baseUrl}${path}`, { headers, agent: false }, (res) => {
    stream.status = res.statusCode ?? 0;
    res.setEncoding('utf8');
    res.on('data', (chunk: string) => {
      stream.raw += chunk;
    });
  });
  req.on('error', () => {});
  openStreams.push(stream);
  return stream;
};

const frameIds = (raw: string) => [...raw.matchAll(/^id: (.*)$/gm)].map((m) => m[1]);

const framePayloads = (raw: string) =>
  [...raw.matchAll(/event: loan-event\ndata: (.+)\n\n/g)].map(
    (m) => JSON.parse(m[1]!) as Record<string, unknown>,
  );

/** Waits for the stream to subscribe, i.e. replay has finished writing. */
const waitForSubscribed = (kind: 'borrower' | 'admin') =>
  waitFor(() => eventStreamService.getConnectionCount()[kind] === 1, `${kind} subscription`);

const waitForFrames = (stream: Stream, count: number) =>
  waitFor(() => frameIds(stream.raw).length >= count, `${count} replay frames`);

beforeAll(async () => {
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  eventStreamService.reset();
  for (const stream of openStreams.splice(0)) stream.destroy();
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  delete process.env.JWT_SECRET;
  delete process.env.INTERNAL_API_KEY;
  delete process.env.ADMIN_WALLETS;
});

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
  eventStreamService.reset();
});

afterEach(() => {
  for (const stream of openStreams.splice(0)) stream.destroy();
  eventStreamService.reset();
});

// ── Ordering ─────────────────────────────────────────────────────────────────

describe('GET /api/events/stream replay ordering', () => {
  it('orders replay by insertion id so ledger ties keep a stable order', async () => {
    mockQuery.mockResolvedValue({
      rows: [eventRow('evt-b'), eventRow('evt-a'), eventRow('evt-c')],
    });

    const stream = openStream(`/api/events/stream?borrower=${BORROWER}`, {
      ...bearer(BORROWER),
      'Last-Event-ID': 'evt-0',
    });
    await waitForFrames(stream, 3);

    // All three rows share ledger and close time: the stream must keep the
    // DB's id order rather than re-sorting by ledger or event id.
    expect(frameIds(stream.raw)).toEqual(['evt-b', 'evt-a', 'evt-c']);
    const [sql] = mockQuery.mock.calls[0]!;
    expect(sql).toContain('ORDER BY id ASC');
  });

  it('does not re-sort replay rows by ledger', async () => {
    mockQuery.mockResolvedValue({
      rows: [eventRow('evt-1', { ledger: 7002 }), eventRow('evt-2', { ledger: 7001 })],
    });

    const stream = openStream('/api/events/stream', {
      ...bearer(ADMIN),
      'Last-Event-ID': 'evt-0',
    });
    await waitFor(() => stream.raw.includes('event: init'), 'admin init');

    expect(frameIds(stream.raw)).toEqual(['evt-1', 'evt-2']);
    expect(stream.raw.indexOf('id: evt-2')).toBeLessThan(stream.raw.indexOf('event: init'));
  });
});

// ── Replay window / pagination ───────────────────────────────────────────────

describe('GET /api/events/stream replay window', () => {
  it('resumes after a trimmed Last-Event-ID with a 100-row cap', async () => {
    openStream(`/api/events/stream?borrower=${BORROWER}`, {
      ...bearer(BORROWER),
      'Last-Event-ID': '  evt-42  ',
    });
    await waitForSubscribed('borrower');

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0]![1]).toEqual([BORROWER, 'evt-42', 100]);
  });

  it('sends init with replayed 0 on a fresh borrower stream with no history', async () => {
    const stream = openStream(`/api/events/stream?borrower=${BORROWER}`, bearer(BORROWER));
    await waitFor(() => stream.raw.includes('event: init'), 'borrower init');

    expect(mockQuery.mock.calls[0]![1]).toEqual([BORROWER, null, 100]);
    expect(stream.raw).toContain(
      `event: init\ndata: ${JSON.stringify({ type: 'init', replayed: 0 })}`,
    );
  });

  it('sends nothing when resuming from the latest event', async () => {
    const stream = openStream(`/api/events/stream?borrower=${BORROWER}`, {
      ...bearer(BORROWER),
      'Last-Event-ID': 'evt-latest',
    });
    await waitForSubscribed('borrower');
    await waitFor(() => stream.status !== 0, 'response headers');
    await sleep(50);

    expect(stream.status).toBe(200);
    expect(stream.raw).toBe('');
  });

  it('defaults a borrower without ?borrower to their own wallet', async () => {
    openStream('/api/events/stream', bearer(BORROWER));
    await waitForSubscribed('borrower');

    expect(mockQuery.mock.calls[0]![1]).toEqual([BORROWER, null, 100]);
  });

  it('replays the global feed for an admin with the same cap', async () => {
    openStream('/api/events/stream', { ...bearer(ADMIN), 'Last-Event-ID': 'evt-9' });
    await waitForSubscribed('admin');

    expect(mockQuery.mock.calls[0]![1]).toEqual(['evt-9', 100]);
  });
});

// ── Missing payloads / failures ──────────────────────────────────────────────

describe('GET /api/events/stream missing payloads', () => {
  it('fills defaults for missing columns instead of dropping the event', async () => {
    mockQuery.mockResolvedValue({ rows: [{ event_id: 'evt-sparse', borrower: BORROWER }] });

    const stream = openStream(`/api/events/stream?borrower=${BORROWER}`, {
      ...bearer(BORROWER),
      'Last-Event-ID': 'evt-0',
    });
    await waitForFrames(stream, 1);

    expect(framePayloads(stream.raw)).toEqual([
      {
        eventId: 'evt-sparse',
        eventType: '',
        address: BORROWER,
        ledger: 0,
        ledgerClosedAt: '',
        txHash: '',
      },
    ]);
  });

  it('emits an empty id when a row has no event_id', async () => {
    mockQuery.mockResolvedValue({ rows: [{ event_type: 'LoanRequested' }] });

    const stream = openStream(`/api/events/stream?borrower=${BORROWER}`, {
      ...bearer(BORROWER),
      'Last-Event-ID': 'evt-0',
    });
    await waitForFrames(stream, 1);

    expect(frameIds(stream.raw)).toEqual(['']);
    expect(framePayloads(stream.raw)[0]).toMatchObject({ eventId: '', eventType: 'LoanRequested' });
  });

  it('keeps the stream open when the replay query fails', async () => {
    mockQuery.mockRejectedValue(new Error('db down'));

    const stream = openStream(`/api/events/stream?borrower=${BORROWER}`, {
      ...bearer(BORROWER),
      'Last-Event-ID': 'evt-0',
    });
    await waitForSubscribed('borrower');
    await waitFor(() => stream.status !== 0, 'response headers');

    expect(stream.status).toBe(200);
    expect(stream.raw).not.toContain('event: loan-event');
  });

  it('still sends the admin init frame when the replay query fails', async () => {
    mockQuery.mockRejectedValue(new Error('db down'));

    const stream = openStream('/api/events/stream', bearer(ADMIN));
    await waitForSubscribed('admin');
    await waitFor(() => stream.raw.includes('event: init'), 'admin init');

    expect(stream.status).toBe(200);
  });
});

// ── Authorization ────────────────────────────────────────────────────────────

describe('event route authorization', () => {
  it('rejects a stream without a JWT', async () => {
    const res = await request(app).get('/api/events/stream');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a borrower streaming another wallet's events", async () => {
    const res = await request(app)
      .get(`/api/events/stream?borrower=${ADMIN}`)
      .set(bearer(BORROWER));

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Borrowers can only subscribe to their own events');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("lets an admin stream any borrower's events", async () => {
    openStream(`/api/events/stream?borrower=${BORROWER}`, bearer(ADMIN));
    await waitForSubscribed('borrower');

    expect(mockQuery.mock.calls[0]![1]).toEqual([BORROWER, null, 100]);
  });

  it('requires an API key for /status', async () => {
    const res = await request(app).get('/api/events/status');
    expect(res.status).toBe(401);
  });

  it('rejects a key without the admin:indexer scope on /status', async () => {
    const res = await request(app).get('/api/events/status').set('x-api-key', 'webhook-value');
    expect(res.status).toBe(403);
  });

  it('returns zeroed counts on /status with an admin:indexer key', async () => {
    const res = await request(app).get('/api/events/status').set('x-api-key', 'indexer-value');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { borrower: 0, admin: 0, total: 0 } });
  });
});
