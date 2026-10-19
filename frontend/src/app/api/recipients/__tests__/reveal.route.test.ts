import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST } from "../[id]/reveal/route";
import { NextRequest } from "next/server";

// Mock next/headers
vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

// Mock fetch globally
global.fetch = vi.fn();

describe("POST /api/recipients/[id]/reveal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when session token is missing", async () => {
    const { cookies } = await import("next/headers");
    vi.mocked(cookies).mockResolvedValue({
      get: vi.fn().mockReturnValue(undefined),
    } as any);

    const request = new NextRequest(new URL("http://localhost:3000"), {
      method: "POST",
      body: JSON.stringify({
        field: "email",
        reason: "Test reason",
      }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ id: "recipient-1" }),
    });

    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json.error).toBe("Unauthorized");
  });

  it("returns 401 when session validation fails", async () => {
    const { cookies } = await import("next/headers");
    vi.mocked(cookies).mockResolvedValue({
      get: vi.fn().mockReturnValue({
        value: "valid-token",
      }),
    } as any);

    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Invalid token" }), { status: 401 })
    );

    const request = new NextRequest(new URL("http://localhost:3000"), {
      method: "POST",
      body: JSON.stringify({
        field: "email",
        reason: "Test reason",
      }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ id: "recipient-1" }),
    });

    expect(response.status).toBe(401);
  });

  it("returns 403 when user role is not admin or operator", async () => {
    const { cookies } = await import("next/headers");
    vi.mocked(cookies).mockResolvedValue({
      get: vi.fn().mockReturnValue({
        value: "valid-token",
      }),
    } as any);

    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ role: "user" }), { status: 200 })
    );

    const request = new NextRequest(new URL("http://localhost:3000"), {
      method: "POST",
      body: JSON.stringify({
        field: "email",
        reason: "Test reason",
      }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ id: "recipient-1" }),
    });

    expect(response.status).toBe(403);
    const json = await response.json();
    expect(json.error).toBe("Forbidden");
  });

  it("returns 400 when field is missing from request body", async () => {
    const { cookies } = await import("next/headers");
    vi.mocked(cookies).mockResolvedValue({
      get: vi.fn().mockReturnValue({
        value: "valid-token",
      }),
    } as any);

    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ role: "admin" }), { status: 200 })
    );

    const request = new NextRequest(new URL("http://localhost:3000"), {
      method: "POST",
      body: JSON.stringify({
        reason: "Test reason",
      }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ id: "recipient-1" }),
    });

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toContain("field and reason are required");
  });

  it("returns 400 when reason is missing from request body", async () => {
    const { cookies } = await import("next/headers");
    vi.mocked(cookies).mockResolvedValue({
      get: vi.fn().mockReturnValue({
        value: "valid-token",
      }),
    } as any);

    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ role: "admin" }), { status: 200 })
    );

    const request = new NextRequest(new URL("http://localhost:3000"), {
      method: "POST",
      body: JSON.stringify({
        field: "email",
      }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ id: "recipient-1" }),
    });

    expect(response.status).toBe(400);
  });

  it("returns 200 with decrypted value when authorized admin requests email", async () => {
    const { cookies } = await import("next/headers");
    vi.mocked(cookies).mockResolvedValue({
      get: vi.fn().mockReturnValue({
        value: "valid-token",
      }),
    } as any);

    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ role: "admin" }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ plaintext: "user@example.com" }), {
          status: 200,
        })
      );

    const request = new NextRequest(new URL("http://localhost:3000"), {
      method: "POST",
      body: JSON.stringify({
        field: "email",
        reason: "Customer verification",
      }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ id: "recipient-1" }),
    });

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.value).toBe("user@example.com");
  });

  it("returns 200 with decrypted value when authorized operator requests phone", async () => {
    const { cookies } = await import("next/headers");
    vi.mocked(cookies).mockResolvedValue({
      get: vi.fn().mockReturnValue({
        value: "valid-token",
      }),
    } as any);

    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ role: "operator" }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ plaintext: "+1234567890" }), {
          status: 200,
        })
      );

    const request = new NextRequest(new URL("http://localhost:3000"), {
      method: "POST",
      body: JSON.stringify({
        field: "phone",
        reason: "Contact update",
      }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ id: "recipient-1" }),
    });

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.value).toBe("+1234567890");
  });

  it("passes request_id header to backend", async () => {
    const { cookies } = await import("next/headers");
    vi.mocked(cookies).mockResolvedValue({
      get: vi.fn().mockReturnValue({
        value: "valid-token",
      }),
    } as any);

    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ role: "admin" }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ plaintext: "test@example.com" }), {
          status: 200,
        })
      );

    const request = new NextRequest(new URL("http://localhost:3000"), {
      method: "POST",
      body: JSON.stringify({
        field: "email",
        reason: "Test",
      }),
    });

    await POST(request, {
      params: Promise.resolve({ id: "recipient-1" }),
    });

    const backendCall = vi.mocked(global.fetch).mock.calls[1];
    const fetchBody = JSON.parse(backendCall[1]?.body as string);
    expect(fetchBody.request_id).toBeDefined();
    expect(fetchBody.request_id).toMatch(/^[0-9a-f-]+$/);
  });

  it("returns 500 when backend decryption fails", async () => {
    const { cookies } = await import("next/headers");
    vi.mocked(cookies).mockResolvedValue({
      get: vi.fn().mockReturnValue({
        value: "valid-token",
      }),
    } as any);

    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ role: "admin" }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Decryption key not found" }), {
          status: 500,
        })
      );

    const request = new NextRequest(new URL("http://localhost:3000"), {
      method: "POST",
      body: JSON.stringify({
        field: "email",
        reason: "Test",
      }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ id: "recipient-1" }),
    });

    expect(response.status).toBe(500);
  });

  it("includes actor role in backend request", async () => {
    const { cookies } = await import("next/headers");
    vi.mocked(cookies).mockResolvedValue({
      get: vi.fn().mockReturnValue({
        value: "valid-token",
      }),
    } as any);

    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ role: "operator" }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ plaintext: "decrypted" }), { status: 200 })
      );

    const request = new NextRequest(new URL("http://localhost:3000"), {
      method: "POST",
      body: JSON.stringify({
        field: "name",
        reason: "Verification",
      }),
    });

    await POST(request, {
      params: Promise.resolve({ id: "recipient-1" }),
    });

    const backendCall = vi.mocked(global.fetch).mock.calls[1];
    const fetchBody = JSON.parse(backendCall[1]?.body as string);
    expect(fetchBody.actor).toBe("operator");
  });
});
