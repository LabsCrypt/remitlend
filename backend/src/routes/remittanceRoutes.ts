import { Router } from "express";
import {
  createRemittance,
  getRemittances,
  getRemittance,
  submitRemittanceTransaction,
} from "../controllers/remittanceController.js";
import { requireJwtAuth, requireScopes } from "../middleware/jwtAuth.js";
import { validate } from "../middleware/validation.js";
import {
  createRemittanceSchema,
  getRemittancesSchema,
  getRemittanceSchema,
} from "../schemas/remittanceSchemas.js";

const router = Router();

/**
 * @swagger
 * /remittances:
 *   post:
 *     summary: Create a new remittance
 *     description: >
 *       Creates a new remittance record and generates an unsigned XDR transaction
 *       for the user to sign with their Stellar wallet (Freighter).
 *     tags: [Remittances]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - recipientAddress
 *               - amount
 *               - fromCurrency
 *               - toCurrency
 *             properties:
 *               recipientAddress:
 *                 type: string
 *                 description: Recipient Stellar public key (56 chars, starts with G)
 *               amount:
 *                 type: number
 *                 description: Amount to send (in units)
 *               fromCurrency:
 *                 type: string
 *                 enum: [USDC, EURC, PHP]
 *               toCurrency:
 *                 type: string
 *                 enum: [USDC, EURC, PHP]
 *               memo:
 *                 type: string
 *                 description: Optional transaction memo (max 28 chars)
 *     responses:
 *       201:
 *         description: Remittance created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Remittance'
 *       400:
 *         description: Invalid input data
 *       401:
 *         description: Missing or invalid Bearer token
 */
router.post(
  "/",
  requireJwtAuth,
  requireScopes("write:remittances"),
  validate(createRemittanceSchema),
  createRemittance,
);

/**
 * @swagger
 * /remittances:
 *   get:
 *     summary: Get user's remittances
 *     description: >
 *       Returns a paginated list of remittances for the authenticated user.
 *       Filters by status if provided.
 *     tags: [Remittances]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [all, pending, processing, completed, failed]
 *           default: all
 *     responses:
 *       200:
 *         description: Remittances retrieved successfully
 *       401:
 *         description: Missing or invalid Bearer token
 */
router.get(
  "/",
  requireJwtAuth,
  requireScopes("read:remittances"),
  validate(getRemittancesSchema),
  getRemittances,
);

/**
 * @swagger
 * /remittances/{id}:
 *   get:
 *     summary: Get a specific remittance
 *     description: >
 *       Returns details of a specific remittance. User must be the sender.
 *     tags: [Remittances]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Remittance ID
 *     responses:
 *       200:
 *         description: Remittance retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Remittance'
 *       401:
 *         description: Missing or invalid Bearer token
 *       403:
 *         description: You do not have access to this remittance
 *       404:
 *         description: Remittance not found
 */
router.get(
  "/:id",
  requireJwtAuth,
  requireScopes("read:remittances"),
  validate(getRemittanceSchema),
  getRemittance,
);

/**
 * @swagger
 * /remittances/{id}/submit:
 *   post:
 *     summary: Submit a signed remittance transaction
 *     description: >
 *       Submits a signed XDR transaction to the Stellar network.
 *       The XDR must be signed using Freighter wallet.
 *     tags: [Remittances]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - signedXdr
 *             properties:
 *               signedXdr:
 *                 type: string
 *                 description: XDR transaction signed by Freighter wallet
 *     responses:
 *       200:
 *         description: Transaction submitted successfully
 *       400:
 *         description: Invalid input or remittance already submitted
 *       401:
 *         description: Missing or invalid Bearer token
 *       403:
 *         description: You do not have access to this remittance
 *       404:
 *         description: Remittance not found
 */
router.post(
  "/:id/submit",
  requireJwtAuth,
  requireScopes("write:remittances"),
  submitRemittanceTransaction,
);

export default router;
