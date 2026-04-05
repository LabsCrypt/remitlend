import { parseCappedLimit } from "../queryHelpers.js";
import type { Request } from "express";

describe("parseCappedLimit", () => {
  const mockRequest = (queryLimit: string | undefined): Partial<Request> => ({
    query: { limit: queryLimit },
  });

  it("should return default limit when no limit is provided", () => {
    const req = mockRequest(undefined) as Request;
    expect(parseCappedLimit(req, 20)).toBe(20);
  });

  it("should return provided limit when within MAX_LIMIT", () => {
    const req = mockRequest("50") as Request;
    expect(parseCappedLimit(req, 20)).toBe(50);
  });

  it("should cap at MAX_LIMIT when provided limit exceeds MAX_LIMIT", () => {
    const req = mockRequest("1000000") as Request;
    expect(parseCappedLimit(req, 20)).toBe(100);
  });

  it("should return default limit when provided limit is invalid", () => {
    const req = mockRequest("invalid") as Request;
    expect(parseCappedLimit(req, 20)).toBe(20);
  });

  it("should return default limit when provided limit is negative", () => {
    const req = mockRequest("-10") as Request;
    expect(parseCappedLimit(req, 20)).toBe(20);
  });

  it("should return default limit when provided limit is zero", () => {
    const req = mockRequest("0") as Request;
    expect(parseCappedLimit(req, 20)).toBe(20);
  });

  it("should handle edge case of exactly MAX_LIMIT", () => {
    const req = mockRequest("100") as Request;
    expect(parseCappedLimit(req, 20)).toBe(100);
  });

  it("should handle decimal numbers by treating them as invalid", () => {
    const req = mockRequest("50.5") as Request;
    expect(parseCappedLimit(req, 20)).toBe(20);
  });
});
