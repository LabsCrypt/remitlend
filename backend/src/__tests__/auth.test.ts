import { describe, it, expect, beforeEach, beforeAll } from "@jest/globals";
import request from "supertest";
import app from "../app.js";
import { Keypair } from "@stellar/stellar-sdk";

describe("Auth API", () => {
  beforeAll(() => {
    process.env.JWT_SECRET = "test-secret-key-for-jest";
  });

  describe("POST /api/auth/challenge", () => {
    it("should generate a challenge for a valid public key", async () => {
      const keypair = Keypair.random();

      const response = await request(app)
        .post("/api/auth/challenge")
        .send({ publicKey: keypair.publicKey() })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.message).toContain("Sign this message");
      expect(response.body.data.nonce).toBeDefined();
      expect(response.body.data.timestamp).toBeDefined();
      expect(response.body.data.expiresIn).toBe(5 * 60 * 1000);
    });

    it("should reject invalid public key", async () => {
      const response = await request(app)
        .post("/api/auth/challenge")
        .send({ publicKey: "invalid-key" })
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it("should reject missing public key", async () => {
      const response = await request(app)
        .post("/api/auth/challenge")
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  describe("POST /api/auth/login", () => {
    it("should login with valid signature", async () => {
      const keypair = Keypair.random();

      const challengeResponse = await request(app)
        .post("/api/auth/challenge")
        .send({ publicKey: keypair.publicKey() })
        .expect(200);

      const message = challengeResponse.body.data.message;
      const signature = keypair
        .sign(Buffer.from(message, "utf-8"))
        .toString("base64");

      const loginResponse = await request(app)
        .post("/api/auth/login")
        .send({
          publicKey: keypair.publicKey(),
          message,
          signature,
        })
        .expect(200);

      expect(loginResponse.body.success).toBe(true);
      expect(loginResponse.body.data.token).toBeDefined();
      expect(loginResponse.body.data.publicKey).toBe(keypair.publicKey());
    });

    it("should reject invalid signature", async () => {
      const keypair = Keypair.random();
      const differentKeypair = Keypair.random();

      const challengeResponse = await request(app)
        .post("/api/auth/challenge")
        .send({ publicKey: keypair.publicKey() })
        .expect(200);

      const message = challengeResponse.body.data.message;
      const wrongSignature = differentKeypair
        .sign(Buffer.from(message, "utf-8"))
        .toString("base64");

      const loginResponse = await request(app)
        .post("/api/auth/login")
        .send({
          publicKey: keypair.publicKey(),
          message,
          signature: wrongSignature,
        })
        .expect(401);

      expect(loginResponse.body.success).toBe(false);
    });

    it("should reject missing fields", async () => {
      const response = await request(app)
        .post("/api/auth/login")
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  describe("GET /api/auth/verify", () => {
    it("should verify valid token", async () => {
      const keypair = Keypair.random();

      const challengeResponse = await request(app)
        .post("/api/auth/challenge")
        .send({ publicKey: keypair.publicKey() })
        .expect(200);

      const message = challengeResponse.body.data.message;
      const signature = keypair
        .sign(Buffer.from(message, "utf-8"))
        .toString("base64");

      const loginResponse = await request(app)
        .post("/api/auth/login")
        .send({
          publicKey: keypair.publicKey(),
          message,
          signature,
        })
        .expect(200);

      const token = loginResponse.body.data.token;

      const verifyResponse = await request(app)
        .get("/api/auth/verify")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(verifyResponse.body.success).toBe(true);
      expect(verifyResponse.body.data.valid).toBe(true);
      expect(verifyResponse.body.data.publicKey).toBe(keypair.publicKey());
      expect(verifyResponse.body.data.role).toBe("borrower");
      expect(Array.isArray(verifyResponse.body.data.scopes)).toBe(true);
      expect(verifyResponse.body.data.scopes).toContain("read:loans");
    });

    it("should reject missing token", async () => {
      const response = await request(app).get("/api/auth/verify").expect(401);

      expect(response.body.success).toBe(false);
    });

    it("should reject invalid token", async () => {
      const response = await request(app)
        .get("/api/auth/verify")
        .set("Authorization", "Bearer invalid-token")
        .expect(401);

      expect(response.body.success).toBe(false);
    });
  });

  describe("Rate limiting", () => {
    it("should return 429 after 10 challenge requests from same IP", async () => {
      const keypair = Keypair.random();
      let lastResponse: any;
      for (let i = 0; i < 11; i++) {
        lastResponse = await request(app)
          .post("/api/auth/challenge")
          .set("X-Forwarded-For", "1.2.3.4")
          .send({ publicKey: keypair.publicKey() });
      }
      expect(lastResponse.status).toBe(429);
      expect(lastResponse.body.success).toBe(false);
    });

    it("should return 429 and Retry-After after 5 login attempts from same IP", async () => {
      const keypair = Keypair.random();
      let lastResponse: any;
      for (let i = 0; i < 6; i++) {
        lastResponse = await request(app)
          .post("/api/auth/login")
          .set("X-Forwarded-For", "5.6.7.8")
          .send({
            publicKey: keypair.publicKey(),
            message: "fake-message",
            signature: "fake-signature",
          });
      }
      expect(lastResponse.status).toBe(429);
      expect(lastResponse.headers["retry-after"]).toBeDefined();
    });

    it("should return 429 after 5 login attempts with same public key", async () => {
      const keypair = Keypair.random();
      let lastResponse: any;
      for (let i = 0; i < 6; i++) {
        lastResponse = await request(app)
          .post("/api/auth/login")
          .set("X-Forwarded-For", `9.9.9.${i}`)
          .send({
            publicKey: keypair.publicKey(),
            message: "fake-message",
            signature: "fake-signature",
          });
      }
      expect(lastResponse.status).toBe(429);
      expect(lastResponse.body.success).toBe(false);
    });
  });
});
