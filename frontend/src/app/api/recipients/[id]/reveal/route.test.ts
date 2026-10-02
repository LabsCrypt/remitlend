/** @jest-environment node */
import { POST } from "./route";
import { NextRequest } from "next/server";
import { cookies } from "next/headers";

jest.mock("next/headers", () => ({
  cookies: jest.fn(),
}));

describe("POST /api/recipients/[id]/reveal", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    (cookies as jest.Mock).mockResolvedValue({
      get: jest.fn().mockReturnValue({ value: "valid-session-token" }),
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function mockAuthSuccess(role: string = "admin") {
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes("/auth/session")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ role }),
        });
      }
      return Promise.reject(new Error("Unhandled fetch call in test mock"));
    }) as jest.Mock;
  }

  it("returns 400 on malformed JSON body", async () => {
    mockAuthSuccess("admin");

    const req = {
      json: jest.fn().mockRejectedValue(new SyntaxError("Unexpected token in JSON")),
    } as unknown as NextRequest;

    const res = await POST(req, {
      params: Promise.resolve({ id: "recipient-123" }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data).toEqual({ error: "Invalid JSON body" });
  });

  it("returns 400 when body.field is not in allowed enum values", async () => {
    mockAuthSuccess("operator");

    const req = {
      json: jest.fn().mockResolvedValue({
        field: "credit_card",
        reason: "Compliance audit",
      }),
    } as unknown as NextRequest;

    const res = await POST(req, {
      params: Promise.resolve({ id: "recipient-123" }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Invalid field requested");
  });

  it("normalizes backend error response without leaking sensitive backend error text", async () => {
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes("/auth/session")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ role: "admin" }),
        });
      }
      if (url.includes("/recipients/recipient-123/decrypt")) {
        return Promise.resolve({
          ok: false,
          status: 500,
          text: () =>
            Promise.resolve(
              "FATAL: PG::ConnectionBad: could not connect to server at 10.0.0.4 at /backend/db.js:142\nstack trace: secret internal info"
            ),
        });
      }
      return Promise.reject(new Error("Unknown route"));
    }) as jest.Mock;

    const req = {
      json: jest.fn().mockResolvedValue({
        field: "email",
        reason: "Investigating chargeback",
      }),
    } as unknown as NextRequest;

    const res = await POST(req, {
      params: Promise.resolve({ id: "recipient-123" }),
    });

    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data).toEqual({ error: "Backend decryption failed" });
    expect(JSON.stringify(data)).not.toContain("FATAL: PG::ConnectionBad");
    expect(JSON.stringify(data)).not.toContain("stack trace");
  });

  it("returns 200 with decrypted value on valid request", async () => {
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes("/auth/session")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ role: "admin" }),
        });
      }
      if (url.includes("/recipients/recipient-123/decrypt")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ plaintext: "user@example.com" }),
        });
      }
      return Promise.reject(new Error("Unknown route"));
    }) as jest.Mock;

    const req = {
      json: jest.fn().mockResolvedValue({
        field: "email",
        reason: "Customer support ticket #492",
      }),
    } as unknown as NextRequest;

    const res = await POST(req, {
      params: Promise.resolve({ id: "recipient-123" }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ value: "user@example.com" });
  });
});
