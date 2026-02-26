import request from "supertest";
import app from "../app.js";

describe("Health Check Endpoint", () => {
  it("should return 200 and a running message on GET /", async () => {
    const response = await request(app).get("/");

    expect(response.status).toBe(200);
    expect(response.text).toBe("RemitLend Backend is running");
  });
});
