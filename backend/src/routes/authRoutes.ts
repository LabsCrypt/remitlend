import { Router } from "express";
import { z } from "zod";
import {
  requestChallenge,
  login,
  verify,
} from "../controllers/authController.js";
import { requireJwtAuth } from "../middleware/jwtAuth.js";
import { validateBody } from "../middleware/validation.js";

const router = Router();

const challengeSchema = z.object({
  publicKey: z.string().min(1, "Public key is required"),
});

const loginSchema = z.object({
  publicKey: z.string().min(1, "Public key is required"),
  message: z.string().min(1, "Message is required"),
  signature: z.string().min(1, "Signature is required"),
});

router.post("/challenge", validateBody(challengeSchema), requestChallenge);

router.post("/login", validateBody(loginSchema), login);

router.get("/verify", requireJwtAuth, verify);

export default router;
