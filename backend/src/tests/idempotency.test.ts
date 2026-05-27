import { Request, Response, NextFunction } from "express";
import { idempotencyMiddleware } from "../middleware/idempotency.js";
import { cacheService } from "../services/cacheService.js";
import { jest } from "@jest/globals";

// Helper to cast to jest.Mock
const asMock = (fn: any) => fn as jest.Mock;

describe("Idempotency Middleware", () => {
  let req: Partial<Request>;
  let res: any; // Using any for easier mocking of the intercepted methods
  let next: NextFunction;

  beforeEach(() => {
    req = {
      header: jest.fn() as any,
      method: "POST",
      originalUrl: "/api/test",
    };
    res = {
      status: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
      on: jest.fn(),
      statusCode: 200,
    };
    next = jest.fn();

    // Mock cacheService explicitly for each test if needed
    // In ESM with Jest, mocking can be tricky, so we rely on manual mocks of the singleton instance if possible
    // or use jest.spyOn if the instance is exported.
    jest.spyOn(cacheService, "get").mockReset();
    jest.spyOn(cacheService, "set").mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("should call next() if no Idempotency-Key is present", async () => {
    asMock(req.header).mockReturnValue(undefined);

    await idempotencyMiddleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
    expect(cacheService.get).not.toHaveBeenCalled();
  });

  it("should return cached response if key exists", async () => {
    const key = "test-key";
    const cachedResponse = { status: 201, body: { success: true } };
    asMock(req.header).mockReturnValue(key);
    (cacheService.get as jest.Mock<() => Promise<any>>).mockResolvedValue(
      cachedResponse,
    );

    await idempotencyMiddleware(req as Request, res as Response, next);

    expect(cacheService.get).toHaveBeenCalledWith(`idemp:${key}`);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.set).toHaveBeenCalledWith("X-Idempotency-Cache", "HIT");
    expect(res.set).toHaveBeenCalledWith("X-Idempotent-Replayed", "true");
    expect(res.json).toHaveBeenCalledWith(cachedResponse.body);
    expect(next).not.toHaveBeenCalled();
  });

  it("should proceed and intercept response on cache miss", async () => {
    const key = "new-key";
    asMock(req.header).mockReturnValue(key);
    (cacheService.get as jest.Mock<() => Promise<any>>).mockResolvedValue(null);

    await idempotencyMiddleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
    expect(res.set).toHaveBeenCalledWith("X-Idempotent-Replayed", "false");
    expect(res.on).toHaveBeenCalledWith("finish", expect.any(Function));
  });

  it("should mark first execution and sequential replay with header values", async () => {
    const key = "sequential-key";
    const cache = new Map<string, unknown>();
    const firstFinishHandlers: Array<() => Promise<void>> = [];

    asMock(req.header).mockReturnValue(key);
    (cacheService.get as jest.Mock<(cacheKey: string) => Promise<unknown>>)
      .mockImplementation(async (cacheKey: string) => cache.get(cacheKey))
      .mockName("cacheService.get");
    (
      cacheService.set as jest.Mock<
        (cacheKey: string, value: unknown) => Promise<void>
      >
    )
      .mockImplementation(async (cacheKey: string, value: unknown) => {
        cache.set(cacheKey, value);
      })
      .mockName("cacheService.set");
    res.on.mockImplementation((event: string, handler: () => Promise<void>) => {
      if (event === "finish") {
        firstFinishHandlers.push(handler);
      }
      return res;
    });

    await idempotencyMiddleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.set).toHaveBeenCalledWith("X-Idempotent-Replayed", "false");

    res.statusCode = 202;
    res.json({ accepted: true });
    const finishHandler = firstFinishHandlers[0];
    if (!finishHandler) {
      throw new Error(
        "Expected idempotency middleware to register finish hook",
      );
    }
    await finishHandler();

    const replayRes = {
      status: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
      on: jest.fn(),
      statusCode: 200,
    };
    const replayNext = jest.fn();

    await idempotencyMiddleware(
      req as Request,
      replayRes as unknown as Response,
      replayNext,
    );

    expect(replayRes.status).toHaveBeenCalledWith(202);
    expect(replayRes.set).toHaveBeenCalledWith("X-Idempotency-Cache", "HIT");
    expect(replayRes.set).toHaveBeenCalledWith("X-Idempotent-Replayed", "true");
    expect(replayRes.json).toHaveBeenCalledWith({ accepted: true });
    expect(replayNext).not.toHaveBeenCalled();
  });
});
