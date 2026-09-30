import request from 'supertest';
import { jest } from '@jest/globals';
import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-jwt-secret-min-32-chars-long!!';
process.env.STELLAR_NETWORK = 'testnet';

const SENDER = Keypair.random().publicKey();
const RECIPIENT = Keypair.random().publicKey();

// Envelope signing keypair (the endpoint validates that the envelope parses and
// carries ≥1 signature, not that its source matches the authenticated wallet).
const envelopeSigner = Keypair.random();

const buildSignedXdr = (): string => {
  const account = new Account(envelopeSigner.publicKey(), '12345');
  const tx = new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.payment({ destination: RECIPIENT, asset: Asset.native(), amount: '1' }))
    .setTimeout(30)
    .build();
  tx.sign(envelopeSigner);
  return tx.toXDR();
};

/* ──────────────────────────────────────────────────────────────────────────
 * In-memory stand-in for the `remittances` table.
 *
 * The real `remittanceService` runs against it, so the SQL the service issues
 * is what decides the outcome: a claim UPDATE without the status guard would
 * match a row that is already past `pending` and let the second submission
 * through, exactly as Postgres would.
 * ────────────────────────────────────────────────────────────────────────── */
interface RemittanceRow {
  id: string;
  sender_id: string;
  recipient_address: string;
  amount: string;
  from_currency: string;
  to_currency: string;
  memo: string | null;
  status: string;
  transaction_hash: string | null;
  error_message: string | null;
  xdr: string | null;
  created_at: Date;
  updated_at: Date;
}

interface MockQueryResult {
  rows: unknown[];
  rowCount: number;
  command: string;
  oid: number;
  fields: unknown[];
}

const REMITTANCE_ID = 'remit-race-1';
const rows = new Map<string, RemittanceRow>();

const result = (returned: unknown[] = []): MockQueryResult => ({
  rows: returned,
  rowCount: returned.length,
  command: 'SELECT',
  oid: 0,
  fields: [],
});

// Read barrier. Every `SELECT * FROM remittances` read is held until the
// expected number of concurrent reads has arrived, so both requests observe
// `pending` before either one writes. The race is therefore *arranged* rather
// than hoped for — the outcome must not depend on request timing.
let expectedReads = 2;
let readsSeen = 0;
let releaseReads: () => void = () => {};
let readsReady: Promise<void> = Promise.resolve();

const resetTable = (reads: number): void => {
  expectedReads = reads;
  readsSeen = 0;
  readsReady = new Promise<void>((resolve) => {
    releaseReads = resolve;
  });
  rows.clear();
  rows.set(REMITTANCE_ID, {
    id: REMITTANCE_ID,
    sender_id: SENDER,
    recipient_address: RECIPIENT,
    amount: '100',
    from_currency: 'USDC',
    to_currency: 'USDC',
    memo: 'race memo',
    status: 'pending',
    transaction_hash: null,
    error_message: null,
    xdr: null,
    created_at: new Date(),
    updated_at: new Date(),
  });
};

const mockQuery = jest.fn(
  async (text: string, params: unknown[] = []): Promise<MockQueryResult> => {
    const sql = text.replace(/\s+/g, ' ').trim();

    if (sql.startsWith('SELECT * FROM remittances')) {
      readsSeen += 1;
      if (readsSeen >= expectedReads) releaseReads();
      await readsReady;
      const row = rows.get(params[0] as string);
      return result(row ? [{ ...row }] : []);
    }

    if (sql.startsWith('SELECT id FROM remittances')) {
      const id = params[0] as string;
      return result(rows.has(id) ? [{ id }] : []);
    }

    if (sql.startsWith('UPDATE remittances')) {
      const status = params[0] as string;
      const transactionHash = params[1] as string | null;
      const errorMessage = params[2] as string | null;
      const id = params[4] as string;
      const row = rows.get(id);

      if (!row) return result();

      // Honour the statement's WHERE clause the way Postgres would: only a
      // claim carrying `AND status = 'pending'` may match a row that is still
      // pending; an unguarded UPDATE always matches.
      const guardedOnPending = sql.includes(`AND status = 'pending'`);
      if (guardedOnPending && row.status !== 'pending') return result();

      const updated: RemittanceRow = {
        ...row,
        status,
        transaction_hash: transactionHash,
        error_message: errorMessage,
        updated_at: new Date(),
      };
      rows.set(id, updated);
      return result([{ ...updated }]);
    }

    return result();
  },
);

jest.unstable_mockModule('../db/connection.js', () => ({
  default: { query: mockQuery, connect: jest.fn(), end: jest.fn(), on: jest.fn() },
  query: mockQuery,
  getClient: jest.fn(),
  closePool: jest.fn(),
  withTransaction: jest.fn(),
}));

const mockSubmitSignedTx = jest.fn();
jest.unstable_mockModule('../services/sorobanService.js', () => ({
  sorobanService: { submitSignedTx: mockSubmitSignedTx },
}));

const mockCreateNotification = jest.fn();
jest.unstable_mockModule('../services/notificationService.js', () => ({
  notificationService: { createNotification: mockCreateNotification },
}));

const fakeCacheStore = new Map<string, unknown>();
jest.unstable_mockModule('../services/cacheService.js', () => ({
  cacheService: {
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

const { default: app } = await import('../app.js');

const bearer = () => ({
  Authorization: `Bearer ${jwt.sign(
    { publicKey: SENDER, role: 'borrower', scopes: ['read:remittances', 'write:remittances'] },
    process.env.JWT_SECRET!,
    { algorithm: 'HS256', expiresIn: '1h' },
  )}`,
});

beforeEach(() => {
  jest.clearAllMocks();
  fakeCacheStore.clear();
  mockSubmitSignedTx.mockResolvedValue({ txHash: 'txhash-race', status: 'SUCCESS' });
  mockCreateNotification.mockResolvedValue(undefined);
});

afterEach(() => {
  // Never leave a request parked on the read barrier.
  releaseReads();
});

describe('POST /api/remittances/:id/submit concurrent submissions (#1850)', () => {
  it('submits exactly one signed tx for two concurrent requests without an Idempotency-Key', async () => {
    resetTable(2);
    const signedXdr = buildSignedXdr();

    // No Idempotency-Key on either request: the idempotency middleware is a
    // no-op here, so deduplication has to come from the status transition.
    const [first, second] = await Promise.all([
      request(app)
        .post(`/api/remittances/${REMITTANCE_ID}/submit`)
        .set(bearer())
        .send({ signedXdr }),
      request(app)
        .post(`/api/remittances/${REMITTANCE_ID}/submit`)
        .set(bearer())
        .send({ signedXdr }),
    ]);

    expect(first.headers['x-idempotent-replayed']).toBeUndefined();
    expect(second.headers['x-idempotent-replayed']).toBeUndefined();

    // Exactly one winner, and the loser is the documented 400 — not a 409, not
    // a second 200, regardless of which request the claim happened to land for.
    const winners = [first, second].filter((res) => res.status === 200);
    const losers = [first, second].filter((res) => res.status === 400);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0]!.body.success).toBe(false);
    expect(losers[0]!.body.message).toContain('already been submitted');
    expect(winners[0]!.body.data.status).toBe('completed');

    // The losing request never reached Stellar and never mutated the record.
    expect(mockSubmitSignedTx).toHaveBeenCalledTimes(1);
    expect(mockSubmitSignedTx).toHaveBeenCalledWith(signedXdr);
    expect(mockCreateNotification).toHaveBeenCalledTimes(1);
    expect(rows.get(REMITTANCE_ID)!.status).toBe('completed');
    expect(rows.get(REMITTANCE_ID)!.transaction_hash).toBe('txhash-race');
  });

  it('rejects a later retry with 400 without touching the network once submitted', async () => {
    resetTable(1);
    const signedXdr = buildSignedXdr();

    const first = await request(app)
      .post(`/api/remittances/${REMITTANCE_ID}/submit`)
      .set(bearer())
      .send({ signedXdr });
    expect(first.status).toBe(200);

    const retry = await request(app)
      .post(`/api/remittances/${REMITTANCE_ID}/submit`)
      .set(bearer())
      .send({ signedXdr });

    expect(retry.status).toBe(400);
    expect(retry.body.message).toContain('already been submitted');
    expect(mockSubmitSignedTx).toHaveBeenCalledTimes(1);
  });

  it('does not flip the remittance to failed when it loses the claim race', async () => {
    resetTable(2);
    const signedXdr = buildSignedXdr();

    const responses = await Promise.all([
      request(app)
        .post(`/api/remittances/${REMITTANCE_ID}/submit`)
        .set(bearer())
        .send({ signedXdr }),
      request(app)
        .post(`/api/remittances/${REMITTANCE_ID}/submit`)
        .set(bearer())
        .send({ signedXdr }),
    ]);

    // The loser's 400 is a client error: the winner's record must survive as
    // `completed` rather than being clobbered to `failed` by the loser.
    expect(responses.filter((res) => res.status === 400)).toHaveLength(1);
    expect(rows.get(REMITTANCE_ID)!.status).toBe('completed');
    expect(rows.get(REMITTANCE_ID)!.error_message).toBeNull();
  });
});
