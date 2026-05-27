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
    expect(res.json).toHaveBeenCalledWith(cachedResponse.body);
    expect(next).not.toHaveBeenCalled();
  });

  it("should proceed and intercept response on cache miss", async () => {
    const key = "new-key";
    asMock(req.header).mockReturnValue(key);
    (cacheService.get as jest.Mock<() => Promise<any>>).mockResolvedValue(null);

    await idempotencyMiddleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
    expect(res.on).toHaveBeenCalledWith("finish", expect.any(Function));
  });
});
