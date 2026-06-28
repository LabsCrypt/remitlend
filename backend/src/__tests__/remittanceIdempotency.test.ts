import request from "supertest";
import { jest } from "@jest/globals";
import { Keypair } from "@stellar/stellar-sdk";
import jwt from "jsonwebtoken";

process.env.JWT_SECRET = "test-jwt-secret-min-32-chars-long!!";

const SENDER = Keypair.random().publicKey();
const RECIPIENT = Keypair.random().publicKey();

let createdCount = 0;
const mockCreateRemittance = jest.fn(async () => {
  createdCount += 1;
  return {
    id: `remittance-${createdCount}`,
    senderId: SENDER,
    recipientAddress: RECIPIENT,
    amount: 100,
    fromCurrency: "USDC",
    toCurrency: "USDC",
    status: "pending" as const,
    xdr: "AAAA...",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
});

jest.unstable_mockModule("../services/remittanceService.js", () => ({
  remittanceService: {
    createRemittance: mockCreateRemittance,
    getRemittances: jest.fn(),
    getRemittance: jest.fn(),
    updateRemittanceStatus: jest.fn(),
  },
}));

// In-memory fake so the idempotency middleware's cache reads/writes actually
// persist across the two requests issued in the test below.
const fakeCacheStore = new Map<string, unknown>();
jest.unstable_mockModule("../services/cacheService.js", () => ({
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

jest.unstable_mockModule("../db/connection.js", () => ({
  default: { query: jest.fn() },
  query: jest.fn(),
  getClient: jest.fn(),
  closePool: jest.fn(),
  withTransaction: jest.fn(),
}));

const { default: app } = await import("../app.js");

const bearer = (publicKey: string) => ({
  Authorization: `Bearer ${jwt.sign(
    { publicKey, role: "borrower", scopes: ["write:remittances"] },
    process.env.JWT_SECRET!,
    { algorithm: "HS256", expiresIn: "1h" },
  )}`,
});

beforeEach(() => {
  jest.clearAllMocks();
  fakeCacheStore.clear();
  createdCount = 0;
});

describe("POST /api/remittances idempotency", () => {
  const payload = {
    recipientAddress: RECIPIENT,
    amount: 100,
    fromCurrency: "USDC",
    toCurrency: "USDC",
  };

  it("creates exactly one remittance for two identical requests sharing an Idempotency-Key", async () => {
    const idempotencyKey = "test-idempotency-key-1";

    const first = await request(app)
      .post("/api/remittances")
      .set(bearer(SENDER))
      .set("Idempotency-Key", idempotencyKey)
      .send(payload);

    expect(first.status).toBe(201);
    expect(first.headers["x-idempotent-replayed"]).toBe("false");

    const second = await request(app)
      .post("/api/remittances")
      .set(bearer(SENDER))
      .set("Idempotency-Key", idempotencyKey)
      .send(payload);

    expect(second.status).toBe(201);
    expect(second.headers["x-idempotent-replayed"]).toBe("true");
    expect(second.body).toEqual(first.body);

    // The underlying service — and therefore the DB insert — only ran once.
    expect(mockCreateRemittance).toHaveBeenCalledTimes(1);
  });

  it("creates a new remittance per request when no Idempotency-Key is supplied", async () => {
    await request(app).post("/api/remittances").set(bearer(SENDER)).send(payload);
    await request(app).post("/api/remittances").set(bearer(SENDER)).send(payload);

    expect(mockCreateRemittance).toHaveBeenCalledTimes(2);
  });
});
