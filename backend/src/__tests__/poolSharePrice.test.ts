import request from "supertest";
import { jest } from "@jest/globals";
import { Keypair } from "@stellar/stellar-sdk";
import { generateJwtToken } from "../services/authService.js";

const lenderPublicKey = Keypair.random().publicKey();
const borrowerPublicKey = Keypair.random().publicKey();
const tokenAddress = Keypair.random().publicKey();

process.env.JWT_SECRET = "test-jwt-secret-min-32-chars-long!!";
process.env.LENDER_WALLETS = lenderPublicKey;

const mockQuery =
  jest.fn<
    (
      sql: string,
      params?: unknown[],
    ) => Promise<{ rows: Record<string, unknown>[]; rowCount: number }>
  >();
const mockGetPoolSharePrice = jest.fn<(token: string) => Promise<number>>();
const mockCacheGet = jest.fn<(key: string) => Promise<unknown | null>>();
const mockCacheSet =
  jest.fn<(key: string, value: unknown, ttlSeconds?: number) => Promise<void>>();

jest.unstable_mockModule("../db/connection.js", () => ({
  default: { query: mockQuery },
  query: mockQuery,
  getClient: jest.fn(),
  closePool: jest.fn(),
  withTransaction: jest.fn(),
}));

jest.unstable_mockModule("../services/cacheService.js", () => ({
  cacheService: {
    get: mockCacheGet,
    set: mockCacheSet,
    ping: jest.fn<() => Promise<string>>().mockResolvedValue("ok"),
  },
}));

jest.unstable_mockModule("../services/sorobanService.js", () => ({
  sorobanService: {
    ping: jest.fn<() => Promise<string>>().mockResolvedValue("ok"),
    getScoreConfig: jest.fn(() => ({
      repaymentDelta: 20,
      defaultPenalty: 50,
      latePenalty: 5,
    })),
    getPoolSharePrice: mockGetPoolSharePrice,
  },
}));

const { default: app } = await import("../app.js");

const bearer = (publicKey: string) => ({
  Authorization: `Bearer ${generateJwtToken(publicKey)}`,
});

function mockAggregateStats(): void {
  mockQuery.mockImplementation(async (sql) => {
    if (sql.includes("Deposit")) {
      return {
        rows: [{ total_deposits: "1000" }],
        rowCount: 1,
      };
    }

    return {
      rows: [{ total_outstanding: "250", active_loans_count: "2" }],
      rowCount: 1,
    };
  });
}

describe("GET /api/pool/:token/share-price", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCacheGet.mockResolvedValue(null);
    mockCacheSet.mockResolvedValue(undefined);
    mockGetPoolSharePrice.mockResolvedValue(1_250_000);
    mockAggregateStats();
  });

  afterAll(() => {
    delete process.env.JWT_SECRET;
    delete process.env.LENDER_WALLETS;
  });

  it("returns the scaled share price, ratio, utilization, and cache metadata", async () => {
    const response = await request(app)
      .get(`/api/pool/${tokenAddress}/share-price`)
      .set(bearer(lenderPublicKey))
      .expect(200);

    expect(mockGetPoolSharePrice).toHaveBeenCalledWith(tokenAddress);
    expect(mockCacheSet).toHaveBeenCalledWith(
      `pool:share-price:${tokenAddress}`,
      expect.objectContaining({
        token: tokenAddress,
        scaledSharePrice: 1_250_000,
        sharePriceScale: 1_000_000,
        sharePriceRatio: 1.25,
        utilizationRate: 0.25,
        cacheTtlSeconds: 30,
      }),
      30,
    );
    expect(response.body).toEqual({
      success: true,
      data: {
        token: tokenAddress,
        scaledSharePrice: 1_250_000,
        sharePriceScale: 1_000_000,
        sharePriceRatio: 1.25,
        utilizationRate: 0.25,
        cacheTtlSeconds: 30,
      },
    });
  });

  it("uses cached token-scoped share price data when available", async () => {
    const cached = {
      token: tokenAddress,
      scaledSharePrice: 1_000_000,
      sharePriceScale: 1_000_000,
      sharePriceRatio: 1,
      utilizationRate: 0,
      cacheTtlSeconds: 30,
    };
    mockCacheGet.mockResolvedValueOnce(cached);

    const response = await request(app)
      .get(`/api/pool/${tokenAddress}/share-price`)
      .set(bearer(lenderPublicKey))
      .expect(200);

    expect(mockGetPoolSharePrice).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockCacheSet).not.toHaveBeenCalled();
    expect(response.body).toEqual({
      success: true,
      data: cached,
    });
  });

  it("rejects authenticated borrowers without read:pool access", async () => {
    await request(app)
      .get(`/api/pool/${tokenAddress}/share-price`)
      .set(bearer(borrowerPublicKey))
      .expect(403);

    expect(mockGetPoolSharePrice).not.toHaveBeenCalled();
  });
});
