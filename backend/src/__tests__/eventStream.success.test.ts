/**
 * Success-path coverage for the SSE event endpoints (#1854).
 *
 * The existing eventStream.test.ts only exercises reject branches. These
 * tests drive the success paths end-to-end through the HTTP layer using a
 * real server plus raw client sockets, because a never-ending SSE response
 * cannot be consumed by a plain supertest request:
 *   - borrower connect, init payload, and service registration
 *   - replay of contract_events rows via the Last-Event-ID header
 *   - admin (subscribeAll) init payload carrying connection counts
 *   - 429 once the per-user SSE connection limit is exhausted
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { jest } from '@jest/globals';

jest.setTimeout(15_000);

process.env.JWT_SECRET = 'test-jwt-secret-min-32-chars-long!!';
process.env.INTERNAL_API_KEY = 'test-internal-key';
process.env.ADMIN_WALLETS = 'GADMINSTREAMUSER';

const BORROWER_KEY = 'GBORROWERSTREAMUSER';
const LIMIT_USER = 'GLIMITEDSTREAMUSER';

type MockQueryResult = { rows: unknown[]; rowCount?: number };

const mockQuery: jest.MockedFunction<
  (text: string, params?: unknown[]) => Promise<MockQueryResult>
> = jest.fn();
jest.unstable_mockModule('../db/connection.js', () => ({
  default: { query: mockQuery },
  query: mockQuery,
  getClient: jest.fn(),
  closePool: jest.fn(),
  withTransaction: jest.fn(),
}));

// The real cacheService lazily creates a Redis client on the first token
// revocation lookup; its reconnect loop keeps the Jest worker alive after the
// run. Use an in-memory stand-in (same pattern as remittanceRoutes.test.ts).
const fakeCacheStore = new Map<string, unknown>();
jest.unstable_mockModule('../services/cacheService.js', () => ({
  cacheService: {
    ping: jest.fn(async () => 'ok'),
    get: jest.fn(async (key: string) => fakeCacheStore.get(key) ?? null),
    set: jest.fn(async (key: string, value: unknown) => {
      fakeCacheStore.set(key, value);
    }),
    setNotExists: jest.fn(async (key: string, value: unknown) => {
      if (fakeCacheStore.has(key)) return false;
      fakeCacheStore.set(key, value);
      return true;
    }),
    delete: jest.fn(async (key: string) => {
      fakeCacheStore.delete(key);
    }),
  },
}));

// Same rationale as remittanceRoutes.test.ts: the real service internals
// (clients/queues) hold event-loop handles that keep the Jest worker alive.
jest.unstable_mockModule('../services/notificationService.js', () => ({
  notificationService: {
    createNotification: jest.fn(),
  },
}));

jest.unstable_mockModule('../services/sorobanService.js', () => ({
  sorobanService: {
    submitSignedTx: jest.fn(),
    ping: jest.fn(async () => 'ok'),
    healthCheck: jest.fn(async () => ({ connected: true, latestLedger: 0 })),
  },
}));

// The real rateLimiter module creates express-rate-limit MemoryStore timers at
// import time (one interval per limiter); those handles keep the Jest worker
// alive after the run ends. HTTP rate limiting is not under test here, so stub
// every exported limiter with a pass-through middleware.
const noopMiddleware = (_req: unknown, _res: unknown, next: () => void) => next();
jest.unstable_mockModule('../middleware/rateLimiter.js', () => ({
  createRateLimiter: () => noopMiddleware,
  globalRateLimiter: noopMiddleware,
  strictRateLimiter: noopMiddleware,
  challengeRateLimiter: noopMiddleware,
  loginRateLimiter: noopMiddleware,
  ipLoginRateLimiter: noopMiddleware,
  verifyRateLimiter: noopMiddleware,
  simulationRateLimiter: noopMiddleware,
}));

await import('../db/connection.js');
const { default: app } = await import('../app.js');
// authService MUST be imported dynamically, after the cacheService mock is
// registered: a static import would instantiate it pre-mock, the auth
// middleware would resolve that real instance, and its Redis connect would
// stay pending forever, keeping the Jest worker alive after the run.
const { generateJwtToken } = await import('../services/authService.js');
const { eventStreamService } = await import('../services/eventStreamService.js');

const bearer = (publicKey: string) => ({
  Authorization: `Bearer ${generateJwtToken(publicKey)}`,
});

// ── Raw SSE client scaffolding ────────────────────────────────────────────────

interface OpenSseStream {
  status: number;
  headers: http.IncomingHttpHeaders;
  raw: string;
  req: http.ClientRequest;
  destroy: () => void;
  waitForData: (needle: string, timeoutMs?: number) => Promise<string>;
  waitForMatch: (pattern: RegExp, timeoutMs?: number) => Promise<RegExpMatchArray>;
}

let server: http.Server;
let baseUrl = '';
const openStreams: OpenSseStream[] = [];

beforeAll(async () => {
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  // Safety net: drop any stream still open, then close the server. All SSE
  // sockets must be force-closed BEFORE close() — it stays pending while
  // active connections exist, which would hang teardown.
  eventStreamService.reset();
  for (const stream of openStreams.splice(0)) {
    stream.destroy();
  }
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  delete process.env.INTERNAL_API_KEY;
  delete process.env.JWT_SECRET;
  delete process.env.ADMIN_WALLETS;
});

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate: () => boolean, what: string, timeoutMs = 2000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error(`Timed out waiting for ${what}`);
    }
    await sleep(10);
  }
}

function openSseStream(path: string, headers: Record<string, string> = {}): OpenSseStream {
  const stream: OpenSseStream = {
    status: 0,
    headers: {},
    raw: '',
    req: null as unknown as http.ClientRequest,
    destroy: () => stream.req.destroy(),
    waitForData: async (needle: string, timeoutMs = 2000) => {
      await waitFor(() => stream.raw.includes(needle), JSON.stringify(needle), timeoutMs);
      return stream.raw;
    },
    waitForMatch: async (pattern: RegExp, timeoutMs = 2000) => {
      await waitFor(() => pattern.test(stream.raw), pattern.source, timeoutMs);
      return stream.raw.match(pattern)!;
    },
  };

  const req = http.get(`${baseUrl}${path}`, { headers, agent: false }, (res) => {
    stream.status = res.statusCode ?? 0;
    stream.headers = res.headers;
    res.setEncoding('utf8');
    res.on('data', (chunk: string) => {
      stream.raw += chunk;
    });
  });
  // Destroying the client socket is how these tests end an SSE connection;
  // the resulting client-side error is expected and ignored.
  req.on('error', () => {});
  stream.req = req;
  openStreams.push(stream);
  return stream;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  eventStreamService.reset();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

afterEach(() => {
  for (const stream of openStreams.splice(0)) {
    stream.destroy();
  }
  eventStreamService.reset();
});

describe('GET /api/events/stream success paths (#1854)', () => {
  it('connects a borrower, sends the init payload, and registers the subscription', async () => {
    const stream = openSseStream(
      `/api/events/stream?borrower=${BORROWER_KEY}`,
      bearer(BORROWER_KEY),
    );

    await stream.waitForData('event: init');

    expect(stream.status).toBe(200);
    expect(stream.headers['content-type']).toBe('text/event-stream');
    expect(stream.headers['cache-control']).toBe('no-cache');
    expect(stream.headers['connection']).toBe('keep-alive');
    expect(stream.headers['x-accel-buffering']).toBe('no');

    const initLine = stream.raw.match(/event: init\ndata: (.+)\n\n/)!;
    expect(JSON.parse(initLine[1]!)).toEqual({ type: 'init', replayed: 0 });

    // The route must have registered the subscription through the service.
    await waitFor(
      () => eventStreamService.getConnectionCount().borrower === 1,
      'borrower registration',
    );
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('FROM contract_events'), [
      BORROWER_KEY,
      null,
      100,
    ]);

    // Closing the client socket must unsubscribe via the req close handler.
    stream.destroy();
    await waitFor(() => eventStreamService.getConnectionCount().total === 0, 'unregistration');
  });

  it('replays contract_events rows for Last-Event-ID before subscribing', async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          event_id: 'evt-100',
          event_type: 'LoanRepaid',
          loan_id: 42,
          address: BORROWER_KEY,
          amount: '10000000',
          ledger: 5001,
          ledger_closed_at: '2026-03-01T00:00:00Z',
          tx_hash: '0xabc100',
        },
        {
          event_id: 'evt-101',
          event_type: 'LoanRequested',
          loan_id: 43,
          address: BORROWER_KEY,
          amount: '25000000',
          ledger: 5002,
          ledger_closed_at: '2026-03-02T00:00:00Z',
          tx_hash: '0xabc101',
        },
      ],
      rowCount: 2,
    });

    const stream = openSseStream(`/api/events/stream?borrower=${BORROWER_KEY}`, {
      ...bearer(BORROWER_KEY),
      'Last-Event-ID': 'evt-prev',
    });

    await stream.waitForData('id: evt-101');

    // Rows are mapped to camelCase loan-event frames, oldest first, and the
    // borrower branch sends no init frame when replay rows exist.
    expect(stream.raw.indexOf('id: evt-100')).toBeLessThan(stream.raw.indexOf('id: evt-101'));
    expect(stream.raw).toContain('event: loan-event');
    expect(stream.raw).toContain('"eventType":"LoanRepaid"');
    expect(stream.raw).toContain('"txHash":"0xabc100"');
    expect(stream.raw).toContain('"loanId":42');
    expect(stream.raw).toContain('"amount":"10000000"');
    expect(stream.raw).toContain('"ledger":5001');
    expect(stream.raw).toContain(`"address":"${BORROWER_KEY}"`);
    expect(stream.raw).not.toContain('event: init');

    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('FROM contract_events'), [
      BORROWER_KEY,
      'evt-prev',
      100,
    ]);

    stream.destroy();
  });

  it('admin without borrower receives the subscribeAll init payload with connection counts', async () => {
    const adminHeaders = bearer('GADMINSTREAMUSER');

    const first = openSseStream('/api/events/stream', adminHeaders);
    await first.waitForData('event: init');
    await waitFor(() => eventStreamService.getConnectionCount().admin === 1, 'first admin setup');

    // The init frame is written before the connection registers itself, so a
    // second connection's init counts reflect the first, not itself.
    const second = openSseStream('/api/events/stream', adminHeaders);
    const initLine = (await second.waitForMatch(/event: init\ndata: (.+)\n\n/))[1]!;
    const initPayload = JSON.parse(initLine) as {
      type: string;
      connections: { borrower: number; admin: number; total: number };
    };

    expect(initPayload.type).toBe('init');
    expect(initPayload.connections).toEqual({ borrower: 0, admin: 1, total: 1 });

    await waitFor(() => eventStreamService.getConnectionCount().admin === 2, 'second admin setup');

    first.destroy();
    second.destroy();
    await waitFor(() => eventStreamService.getConnectionCount().total === 0, 'cleanup');
  });

  it('returns 429 through the route when the per-user connection limit is exhausted', async () => {
    const connections = [
      openSseStream(`/api/events/stream?borrower=${LIMIT_USER}`, bearer(LIMIT_USER)),
      openSseStream(`/api/events/stream?borrower=${LIMIT_USER}`, bearer(LIMIT_USER)),
      openSseStream(`/api/events/stream?borrower=${LIMIT_USER}`, bearer(LIMIT_USER)),
    ];
    await waitFor(
      () => eventStreamService.getUserConnectionCount(LIMIT_USER) === 3,
      'three live SSE connections',
    );

    // A fourth HTTP request for the same user must be rejected by
    // canOpenConnection before any SSE headers are written.
    const response = await request(app).get('/api/events/stream').set(bearer(LIMIT_USER));

    expect(response.status).toBe(429);
    expect(response.body.message).toContain('Maximum of 3 SSE connections allowed per user');

    for (const connection of connections) {
      connection.destroy();
    }
    await waitFor(() => eventStreamService.getConnectionCount().total === 0, 'cleanup');
  });
});
