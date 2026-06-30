import { registerTestUser } from '../controllers/authController.js';
import { Router } from 'express';
import { z } from 'zod';
import { requestChallenge, login, verify, logout } from '../controllers/authController.js';
import {
  challengeRateLimiter,
  loginRateLimiter,
  ipLoginRateLimiter,
} from '../middleware/rateLimiter.js';
import { requireJwtAuth } from '../middleware/jwtAuth.js';
import { validateBody } from '../middleware/validation.js';

const router = Router();

// TEST/DEV ONLY: Register a test user
if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development') {
  router.post('/register', registerTestUser);
}

const challengeSchema = z.object({
  publicKey: z.string().min(1, 'Public key is required'),
});

const loginSchema = z.object({
  publicKey: z.string().min(1, 'Public key is required'),
  message: z.string().min(1, 'Message is required'),
  signature: z.string().min(1, 'Signature is required'),
});

/**
 * @swagger
 * /auth/challenge:
 *   post:
 *     summary: Request a sign-in message (public)
 *     description: Returns a nonce and message for the wallet to sign. No authentication required.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [publicKey]
 *             properties:
 *               publicKey:
 *                 type: string
 *                 description: Stellar public key (G…)
 *     responses:
 *       200:
 *         description: Challenge payload
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthChallengeResponse'
 */
router.post('/challenge', challengeRateLimiter, validateBody(challengeSchema), requestChallenge);

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Exchange signed challenge for JWT (public)
 *     description: Verifies the Ed25519 signature and returns a Bearer token.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [publicKey, message, signature]
 *             properties:
 *               publicKey:
 *                 type: string
 *               message:
 *                 type: string
 *               signature:
 *                 type: string
 *                 description: Base64-encoded signature
 *     responses:
 *       200:
 *         description: JWT issued
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthLoginResponse'
 */
router.post('/login', ipLoginRateLimiter, loginRateLimiter, validateBody(loginSchema), login);

/**
 * @swagger
 * /auth/verify:
 *   get:
 *     summary: Verify JWT and return wallet info
 *     tags: [Auth]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Token valid
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthVerifyResponse'
 *       401:
 *         description: Missing or invalid Bearer token
 */
router.get('/verify', requireJwtAuth, verify);

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     summary: Revoke the current JWT
 *     description: >
 *       Blacklists the current token's jti so it is rejected by requireJwtAuth
 *       even though it has not yet expired, and clears the auth cookie.
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logged out successfully
 *       401:
 *         description: Missing or invalid Bearer token
 */
router.post('/logout', requireJwtAuth, logout);

export default router;
