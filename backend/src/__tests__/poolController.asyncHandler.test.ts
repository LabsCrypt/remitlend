import { jest } from "@jest/globals";
import type { NextFunction, Request, Response } from "express";

const mockQuery = jest.fn<
  (
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: Record<string, unknown>[]; rowCount: number }>
>();

jest.unstable_mockModule("../db/connection.js", () => ({
  query: mockQuery,
}));

const { getPoolStats, getDepositorPortfolio } = await import(
  "../controllers/poolController.js"
);

const flushAsync = async (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

const createMockResponse = (): Response => {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res as Response);
  res.json = jest.fn().mockReturnValue(res as Response);
  return res as Response;
};

describe("poolController asyncHandler wrapping", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("forwards async errors from getPoolStats to next()", async () => {
    const error = new Error("db failed");
    mockQuery.mockRejectedValue(error);

    const res = createMockResponse();
    const next = jest.fn<(err?: unknown) => void>();

    getPoolStats({} as Request, res, next as unknown as NextFunction);
    await flushAsync();

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0]?.[0]).toBe(error);
    expect(res.json).not.toHaveBeenCalled();
  });

  it("forwards async errors from getDepositorPortfolio to next()", async () => {
    const error = new Error("db failed");
    mockQuery.mockRejectedValue(error);

    const req = { params: { address: "GTESTADDRESS123" } } as unknown as Request;
    const res = createMockResponse();
    const next = jest.fn<(err?: unknown) => void>();

    getDepositorPortfolio(req, res, next as unknown as NextFunction);
    await flushAsync();

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0]?.[0]).toBe(error);
    expect(res.json).not.toHaveBeenCalled();
  });
});
