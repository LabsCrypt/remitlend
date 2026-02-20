import { Router } from 'express';
import { getRemittanceHistory, simulatePayment } from '../controllers/simulationController.js';
import { validate } from '../middleware/validation.js';
import { getRemittanceHistorySchema, simulatePaymentSchema } from '../schemas/simulationSchemas.js';
import { strictRateLimiter } from '../middleware/rateLimiter.js';

const router = Router();

/**
 * @swagger
 * /history/{userId}:
 *   get:
 *     summary: Get remittance history for a user
 *     description: Retrieve the remittance history for a specific user by their ID.
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
 *               type: object
 *               properties:
 *                 userId:
 *                   type: string
 *                   description: The ID of the user.
 *                 score:
 *                   type: integer
 *                   description: The user's current score.
 *                 streak:
 *                   type: integer
 *                   description: The user's current streak.
 *                 history:
 *                   type: array
 *                   description: The user's remittance history.
 *                   items:
 *                     type: object
 *       404:
 *         description: User not found or no remittance history available.
 */

router.get('/history/:userId', validate(getRemittanceHistorySchema), getRemittanceHistory);


/**
 * @swagger
 * /simulate:
 *   post:
 *     summary: Simulate a remittance payment
 *     description: Simulate a remittance payment and return the simulation result.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               userId:
 *                 type: string
 *                 description: ID of the user.
 *               amount:
 *                 type: number
 *                 description: Amount to simulate remittance for.
 *             required:
 *               - userId
 *               - amount
 *     responses:
 *       200:
 *         description: Simulation successful.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Payment of 500 for user 123 simulated.
 *                 newScore:
 *                   type: integer
 *                   example: 760
 *       400:
 *         description: Invalid input data.
 */
router.post('/simulate', strictRateLimiter, validate(simulatePaymentSchema), simulatePayment);

export default router;
