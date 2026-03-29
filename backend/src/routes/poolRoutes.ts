import { Router } from "express";
import {
  getPoolStats,
  getDepositorPortfolio,
  depositToPool,
  withdrawFromPool,
  submitPoolTransaction,
} from "../controllers/poolController.js";
import {
  requireLender,
  requireJwtAuth,
  requireScopes,
  requireWalletParamMatchesJwt,
} from "../middleware/jwtAuth.js";
import { validate } from "../middleware/validation.js";
import { idempotencyMiddleware } from "../middleware/idempotency.js";
import { addressParamSchema } from "../schemas/stellarSchemas.js";

const router = Router();

/**
 * @swagger
 * /pool/stats:
 *   get:
 *     summary: Get aggregate lending pool statistics
 *     description: >
 *       Returns total deposits, utilization rate, current APY, and the
 *       number of active loans. Intended for the lender dashboard.
 *     tags: [Pool]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Pool statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PoolStatsResponse'
 *       401:
 *         description: Missing or invalid Bearer token
 */
router.get(
  "/stats",
  requireJwtAuth,
  requireLender,
  requireScopes("read:pool"),
  getPoolStats,
);

/**
 * @swagger
 * /pool/depositor/{address}:
 *   get:
 *     summary: Get depositor portfolio for a wallet address
 *     description: >
 *       Returns deposit amount, pool share percentage, and estimated yield
 *       for the authenticated depositor. `address` must match the JWT wallet.
 *     tags: [Pool]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: address
 *         required: true
 *         schema:
 *           type: string
 *         description: Depositor's Stellar address (must match JWT)
 *     responses:
 *       200:
 *         description: Depositor portfolio retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DepositorPortfolioResponse'
 *       401:
 *         description: Missing or invalid Bearer token
 *       403:
 *         description: address does not match authenticated wallet
 */
router.get(
  "/depositor/:address",
  requireJwtAuth,
  requireLender,
  requireScopes("read:pool"),
  requireWalletParamMatchesJwt("address"),
  validate(addressParamSchema),
  getDepositorPortfolio,
);

/**
 * @swagger
 * /pool/deposit:
 *   post:
 *     summary: Build an unsigned deposit transaction
 *     description: >
 *       Builds an unsigned Soroban `deposit(provider, token, amount)` transaction XDR
 *       against the LendingPool contract. The frontend signs it with the user's wallet
 *       and submits via POST /api/pool/submit.
 *     tags: [Pool]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - depositorPublicKey
 *               - amount
 *             properties:
 *               depositorPublicKey:
 *                 type: string
 *                 description: Depositor's Stellar public key (must match JWT)
 *               amount:
 *                 type: number
 *                 description: Amount to deposit
 *                 example: 1000
 *     responses:
 *       200:
 *         description: Unsigned transaction XDR returned
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UnsignedTransactionResponse'
 *       400:
 *         description: Validation error
 *       401:
 *         description: Missing or invalid Bearer token
 */
router.post(
  "/deposit",
  requireJwtAuth,
  requireLender,
  requireScopes("write:pool"),
  idempotencyMiddleware,
  depositToPool,
);

/**
 * @swagger
 * /pool/withdraw:
 *   post:
 *     summary: Build an unsigned withdraw transaction
 *     description: >
 *       Builds an unsigned Soroban `withdraw(provider, token, shares)` transaction XDR
 *       against the LendingPool contract. The frontend signs it with the user's wallet
 *       and submits via POST /api/pool/submit.
 *     tags: [Pool]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - depositorPublicKey
 *               - amount
 *             properties:
 *               depositorPublicKey:
 *                 type: string
 *                 description: Depositor's Stellar public key (must match JWT)
 *               amount:
 *                 type: number
 *                 description: Amount (shares) to withdraw
 *                 example: 500
 *     responses:
 *       200:
 *         description: Unsigned transaction XDR returned
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UnsignedTransactionResponse'
 *       400:
 *         description: Validation error
 *       401:
 *         description: Missing or invalid Bearer token
 */
router.post(
  "/withdraw",
  requireJwtAuth,
  requireLender,
  requireScopes("write:pool"),
  idempotencyMiddleware,
  withdrawFromPool,
);

/**
 * @swagger
 * /pool/submit:
 *   post:
 *     summary: Submit a signed pool transaction
 *     description: >
 *       Submits a signed transaction XDR to the Stellar network for a pool
 *       deposit or withdrawal.
 *     tags: [Pool]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - signedTxXdr
 *             properties:
 *               signedTxXdr:
 *                 type: string
 *                 description: Signed transaction XDR
 *     responses:
 *       200:
 *         description: Transaction submitted and result returned
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SubmittedTransactionResponse'
 *       400:
 *         description: Validation error
 *       401:
 *         description: Missing or invalid Bearer token
 */
router.post(
  "/submit",
  requireJwtAuth,
  requireLender,
  requireScopes("write:pool"),
  idempotencyMiddleware,
  submitPoolTransaction,
);

export default router;
