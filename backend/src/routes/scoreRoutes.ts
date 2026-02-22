import { Router } from "express";
import { getScore, updateScore } from "../controllers/scoreController.js";
import { validate } from "../middleware/validation.js";
import { getScoreSchema, updateScoreSchema } from "../schemas/scoreSchemas.js";
import { requireApiKey } from "../middleware/auth.js";
import { strictRateLimiter } from "../middleware/rateLimiter.js";

const router = Router();

/**
 * @swagger
 * /score/{userId}:
 *   get:
 *     summary: Retrieve a user's credit score
 *     description: >
 *       Returns the current credit score, credit band, and key scoring factors
 *       for the specified user. Used by LoanManager and other contracts to
 *       make lending decisions.
 *     tags: [Score]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
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
 */
router.get("/:userId", validate(getScoreSchema), getScore);

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
 *               $ref: '#/components/schemas/UserScore'
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
  strictRateLimiter,
  validate(updateScoreSchema),
  updateScore,
);

export default router;
