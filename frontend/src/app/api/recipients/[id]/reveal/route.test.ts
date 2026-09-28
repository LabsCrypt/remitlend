/**
 * @jest-environment node
 *
 * api/recipients/[id]/reveal/route.test.ts
 *
 * Unit tests for the recipient PII reveal route handler.
 */

import { NextRequest } from "next/server";
import { POST } from "./route";

const mockGetCookie = jest.fn();

jest.mock("next/headers", () => ({
  cookies: jest.fn(() =>
    Promise.resolve({
      get: mockGetCookie,
    }),
  ),
}));

describe("POST /api/recipients/[id]/reveal", () => {
  const originalFetch = global.fetch;
  const originalEnvApiUrl = process.env.API_URL;
  const mockParams = Promise.resolve({ id: "rec-123" });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.API_URL = "http://localhost:3001";
    mockGetCookie.mockReturnValue({ value: "valid-session-token" });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.API_URL = originalEnvApiUrl;
  });

  function createRequest(body: Record<string, unknown>): NextRequest {
    return new NextRequest("http://localhost:3000/api/recipients/rec-123/reveal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("returns 401 Unauthorized when session cookie is missing", async () => {
    mockGetCookie.mockReturnValue(undefined);

    const req = createRequest({ field: "email", reason: "KYC check" });
    const res = await POST(req, { params: mockParams });

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json).toEqual({ error: "Unauthorized" });
  });

  it("returns 500 when session validation fetch fails unexpectedly", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("Network connection error"));

    const req = createRequest({ field: "email", reason: "KYC check" });
    const res = await POST(req, { params: mockParams });

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({ error: "Session validation failed" });
  });

  it("returns 401 Unauthorized when session validation endpoint returns non-ok", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
    } as Response);

    const req = createRequest({ field: "email", reason: "KYC check" });
    const res = await POST(req, { params: mockParams });

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json).toEqual({ error: "Unauthorized" });
  });

  it("returns 403 Forbidden when user role is not admin or operator", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ role: "borrower" }),
    } as Response);

    const req = createRequest({ field: "email", reason: "KYC check" });
    const res = await POST(req, { params: mockParams });

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json).toEqual({ error: "Forbidden" });
  });

  it("returns 403 Forbidden when user role is missing from session", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as Response);

    const req = createRequest({ field: "email", reason: "KYC check" });
    const res = await POST(req, { params: mockParams });

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json).toEqual({ error: "Forbidden" });
  });

  it("returns 400 when field is missing", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ role: "admin" }),
    } as Response);

    const req = createRequest({ reason: "KYC check" });
    const res = await POST(req, { params: mockParams });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toEqual({ error: "field and reason are required" });
  });

  it("returns 400 when reason is missing", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ role: "admin" }),
    } as Response);

    const req = createRequest({ field: "email" });
    const res = await POST(req, { params: mockParams });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toEqual({ error: "field and reason are required" });
  });

  it("passes through backend decryption error text and status code", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ role: "admin" }),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => "Recipient not found",
      } as unknown as Response);

    const req = createRequest({ field: "email", reason: "Compliance audit" });
    const res = await POST(req, { params: mockParams });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json).toEqual({ error: "Recipient not found" });
  });

  it("returns 500 when backend decryption fetch throws an error", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ role: "operator" }),
      } as Response)
      .mockRejectedValueOnce(new Error("Backend service unreachable"));

    const req = createRequest({ field: "phone", reason: "Dispute resolution" });
    const res = await POST(req, { params: mockParams });

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({ error: "Decryption failed" });
  });

  it("successfully returns decrypted plaintext for admin role", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ role: "admin" }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ plaintext: "alice@example.com" }),
      } as Response);
    global.fetch = fetchMock;

    const req = createRequest({ field: "email", reason: "KYC verification" });
    const res = await POST(req, { params: mockParams });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ value: "alice@example.com" });

    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Verify session validation call
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://localhost:3001/auth/session",
      expect.objectContaining({
        headers: { Authorization: "Bearer valid-session-token" },
      }),
    );

    // Verify backend decryption call
    const decryptCall = fetchMock.mock.calls[1];
    expect(decryptCall[0]).toBe("http://localhost:3001/recipients/rec-123/decrypt");
    expect(decryptCall[1].method).toBe("POST");
    expect(decryptCall[1].headers).toEqual(
      expect.objectContaining({
        "Content-Type": "application/json",
        Authorization: "Bearer valid-session-token",
        "X-Request-Id": expect.any(String),
      }),
    );
    const decryptBody = JSON.parse(decryptCall[1].body);
    expect(decryptBody).toEqual({
      field: "email",
      actor: "admin",
      reason: "KYC verification",
      request_id: expect.any(String),
    });
  });

  it("successfully returns decrypted plaintext for operator role", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ role: "operator" }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ plaintext: "+1234567890" }),
      } as Response);

    const req = createRequest({ field: "phone", reason: "Fraud review" });
    const res = await POST(req, { params: mockParams });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ value: "+1234567890" });
  });
});
