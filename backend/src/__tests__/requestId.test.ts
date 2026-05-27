import request from "supertest";
import app from "../app.js";
import logger from "../utils/logger.js";
import { jest } from "@jest/globals";

import express from "express";
import { requestIdMiddleware } from "../middleware/requestId.js";

describe("Request ID middleware", () => {
  it("adds x-request-id when missing", async () => {
    const response = await request(app).get("/");
    const requestId = response.headers["x-request-id"] as string | undefined;

    expect(response.status).toBe(200);
    expect(requestId).toBeDefined();
    expect(typeof requestId).toBe("string");
    expect((requestId ?? "").length).toBeGreaterThan(0);
  });

  it("preserves client x-request-id", async () => {
    const requestId = "test-request-id-123";

    const response = await request(app).get("/").set("x-request-id", requestId);

    expect(response.status).toBe(200);
    expect(response.headers["x-request-id"]).toBe(requestId);
  });

  it("correlates logger requestId with x-request-id via withContext", async () => {
    const tempApp = express();
    tempApp.use(requestIdMiddleware);
    tempApp.get("/test", (req, res) => {
      logger.withContext().info("Testing withContext correlation");
      res.sendStatus(200);
    });

    const infoSpy = jest
      .spyOn(logger, "info")
      .mockImplementation(() => logger as any);

    const response = await request(tempApp).get("/test");
    const requestId = response.headers["x-request-id"];

    expect(response.status).toBe(200);
    expect(infoSpy).toHaveBeenCalledWith(
      "Testing withContext correlation",
      expect.objectContaining({ requestId }),
    );

    infoSpy.mockRestore();
  });
});
