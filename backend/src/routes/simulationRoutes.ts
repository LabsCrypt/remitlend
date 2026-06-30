import { Router } from 'express';
import { getRemittanceHistory, simulatePayment } from '../controllers/simulationController.js';
import { validate } from '../middleware/validation.js';
import { getRemittanceHistorySchema, simulatePaymentSchema } from '../schemas/simulationSchemas.js';
import { simulationRateLimiter } from '../middleware/rateLimiter.js';
import { requireJwtAuth, requireWalletParamMatchesJwt } from '../middleware/jwtAuth.js';

const router = Router();

/**
 * @swagger
 * /history/{userId}:
 *   get:
 *     summary: Get remittance history for a user
 *     description: Retrieve the remittance history for the authenticated user. The userId path parameter must match the JWT wallet.
 *     tags: [Simulation]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Successfully retrieved remittance history.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/RemittanceHistory'
 *       401:
 *         description: Missing or invalid authentication.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Authenticated wallet does not match userId.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: User not found or no remittance history available.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */

router.get(
  '/history/:userId',
  simulationRateLimiter,
  requireJwtAuth,
  requireWalletParamMatchesJwt('userId'),
  validate(getRemittanceHistorySchema),
  getRemittanceHistory,
);

/**
 * @swagger
 * /simulate:
 *   post:
 *     summary: Simulate a remittance payment
 *     description: Simulate a remittance payment for the authenticated user and return the projected score change.
 *     tags: [Simulation]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               amount:
 *                 type: number
 *                 description: Amount to simulate remittance for.
 *             required:
 *               - amount
 *     responses:
 *       200:
 *         description: Simulation successful.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SimulatePaymentResponse'
 *       400:
 *         description: Invalid input data.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Missing or invalid authentication.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  '/simulate',
  simulationRateLimiter,
  requireJwtAuth,
  validate(simulatePaymentSchema),
  simulatePayment,
);

export default router;
