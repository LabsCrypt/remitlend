import { Router } from "express";
import {
  getScore,
  updateScore,
  getScoreBreakdown,
} from "../controllers/scoreController.js";
import { validate } from "../middleware/validation.js";
import { getScoreSchema, updateScoreSchema } from "../schemas/scoreSchemas.js";
import { requireApiKey } from "../middleware/auth.js";
import { scoreUpdateRateLimit } from "../middleware/rateLimitMiddleware.js";
import {
  requireJwtAuth,
  requireScopes,
  requireWalletParamMatchesJwt,
} from "../middleware/jwtAuth.js";

const router = Router();

/**
 * @swagger
 * /score/{userId}:
 *   get:
 *     summary: Retrieve a user's credit score
 *     description: >
 *       Returns the current credit score for the authenticated wallet only:
 *       `userId` must match the Stellar public key in the JWT.
 *     tags: [Score]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: Must equal the JWT wallet (`publicKey`)
 *     responses:
 *       200:
 *         description: Score retrieved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UserScore'
 *       400:
 *         description: Invalid user ID.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Missing or invalid Bearer token.
 *       403:
 *         description: userId does not match the authenticated wallet.
 */
router.get(
  "/:userId",
  requireJwtAuth,
  requireScopes("read:score"),
  requireWalletParamMatchesJwt("userId"),
  validate(getScoreSchema),
  getScore,
);

/**
 * @swagger
 * /score/{userId}/breakdown:
 *   get:
 *     summary: Get a detailed credit score breakdown
 *     description: >
 *       Returns the user's credit score along with a detailed breakdown of
 *       contributing factors (repayment history, streaks, defaults) and a
 *       score history timeline. Derived from loan_events and scores tables.
 *       `userId` must match the Stellar public key in the JWT.
 *     tags: [Score]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: Must equal the JWT wallet (`publicKey`)
 *     responses:
 *       200:
 *         description: Score breakdown retrieved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ScoreBreakdownResponse'
 *       401:
 *         description: Missing or invalid Bearer token.
 *       403:
 *         description: userId does not match the authenticated wallet.
 */
router.get(
  "/:userId/breakdown",
  requireJwtAuth,
  requireWalletParamMatchesJwt("userId"),
  validate(getScoreSchema),
  getScoreBreakdown,
);

/**
 * @swagger
 * /score/update:
 *   post:
 *     summary: Update a user's credit score based on repayment history
 *     description: >
 *       Adjusts the user's credit score by +15 for on-time repayments or
 *       −30 for late payments. Requires the `x-api-key` header to be set
 *       to the value of the `INTERNAL_API_KEY` environment variable.
 *     tags: [Score]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *               - repaymentAmount
 *               - onTime
 *             properties:
 *               userId:
 *                 type: string
 *               repaymentAmount:
 *                 type: number
 *                 example: 500
 *               onTime:
 *                 type: boolean
 *                 example: true
 *     responses:
 *       200:
 *         description: Score updated successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ScoreUpdateResponse'
 *       400:
 *         description: Validation error.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Unauthorised — missing or invalid API key.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  "/update",
  requireApiKey,
  scoreUpdateRateLimit,
  validate(updateScoreSchema),
  updateScore,
);

export default router;
