import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  ApiError,
  apiFetch,
  normalizeApiResponse,
  normalizeResponseEnvelope,
  unwrapApiResponse,
} from "./useApi";
import { useUserStore } from "../stores/useUserStore";

const originalFetch = globalThis.fetch;

function jsonResponse(status: number, body: unknown, statusText = "") {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: async () => body,
  } as Response;
}

describe("apiFetch error envelope", () => {
  beforeEach(() => {
    useUserStore.setState({ user: null, authToken: null, isAuthenticated: false });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    useUserStore.setState({ user: null, authToken: null, isAuthenticated: false });
    jest.restoreAllMocks();
  });

  it("preserves HTTP status and error code on ApiError", async () => {
    globalThis.fetch = jest
      .fn<() => Promise<Response>>()
      .mockResolvedValue(
        jsonResponse(409, { message: "Loan already exists", code: "LOAN_CONFLICT" }, "Conflict"),
      ) as unknown as typeof fetch;

    let caught: unknown;
    try {
      await apiFetch("/loans");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ApiError);
    const apiError = caught as ApiError;
    expect(apiError.name).toBe("ApiError");
    expect(apiError.status).toBe(409);
    expect(apiError.statusCode).toBe(409);
    expect(apiError.code).toBe("LOAN_CONFLICT");
    expect(apiError.message).toBe("Loan already exists");
  });

  it("reads errors nested under the error key", async () => {
    globalThis.fetch = jest
      .fn<() => Promise<Response>>()
      .mockResolvedValue(
        jsonResponse(404, { error: { message: "Loan not found", code: "NOT_FOUND" } }),
      ) as unknown as typeof fetch;

    await expect(apiFetch("/loans/1")).rejects.toMatchObject({
      status: 404,
      code: "NOT_FOUND",
      message: "Loan not found",
    });
  });

  it("falls back to the HTTP status when the body is not JSON", async () => {
    globalThis.fetch = jest.fn<() => Promise<Response>>().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "",
      json: async () => {
        throw new Error("invalid json");
      },
      text: async () => "",
    } as unknown as Response) as unknown as typeof fetch;

    await expect(apiFetch("/loans")).rejects.toMatchObject({
      name: "ApiError",
      status: 500,
      message: "Request failed with status 500",
    });
  });
});

describe("normalizeApiResponse", () => {
  it("unwraps each response envelope shape through one normalizer", () => {
    expect(normalizeApiResponse<{ id: number }>({ success: true, data: { id: 1 } })).toEqual({
      id: 1,
    });
    expect(
      normalizeApiResponse<Array<{ id: number }>>({ success: true, disputes: [{ id: 2 }] }, [
        "disputes",
        "data",
      ]),
    ).toEqual([{ id: 2 }]);
    expect(
      normalizeApiResponse<{ id: number }>({ success: true, dispute: { id: 3 } }, [
        "dispute",
        "data",
      ]),
    ).toEqual({ id: 3 });
    expect(
      normalizeApiResponse<{ months: number[] }>(
        { success: true, amortization: { months: [1, 2] } },
        "amortization",
      ),
    ).toEqual({ months: [1, 2] });
    expect(normalizeApiResponse<number[]>([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it("exposes the same normalizer through its aliases", () => {
    expect(normalizeResponseEnvelope).toBe(normalizeApiResponse);
    expect(unwrapApiResponse).toBe(normalizeApiResponse);
  });
});
