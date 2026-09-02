import { Router } from 'express';
import {
  getPoolStats,
  getDepositorPortfolio,
  getDepositorYieldHistory,
  depositToPool,
  withdrawFromPool,
  emergencyWithdrawFromPool,
  getPoolSharePrice,
  submitPoolTransaction,
} from '../controllers/poolController.js';
import {
  requireLender,
  requireJwtAuth,
  requireScopes,
  requireWalletParamMatchesJwt,
} from '../middleware/jwtAuth.js';
import { validate, validateBody } from '../middleware/validation.js';
import { idempotencyMiddleware } from '../middleware/idempotency.js';
import { addressParamSchema } from '../schemas/stellarSchemas.js';
import {
  buildPoolTransactionSchema,
  emergencyWithdrawSchema,
  getDepositorYieldHistorySchema,
  submitTxSchema,
} from '../schemas/poolSchemas.js';

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
router.get('/stats', requireJwtAuth, requireLender, requireScopes('read:pool'), getPoolStats);

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
  '/depositor/:address',
  requireJwtAuth,
  requireLender,
  requireScopes('read:pool'),
  requireWalletParamMatchesJwt('address'),
  validate(addressParamSchema),
  getDepositorPortfolio,
);

/**
 * @swagger
 * /pool/depositor/{address}/yield-history:
 *   get:
 *     summary: Get per-depositor yield history
 *     description: >
 *       Returns a bounded time series of deposited value, current share value,
 *       and net yield for the authenticated depositor. Supports `days` query
 *       param (7, 30, or 90).
 *     tags: [Pool]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: address
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *           enum: [7, 30, 90]
 *           default: 30
 *       - in: query
 *         name: token
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Yield history retrieved successfully
 *       401:
 *         description: Missing or invalid Bearer token
 *       403:
 *         description: address does not match authenticated wallet
 */
router.get(
  '/depositor/:address/yield-history',
  requireJwtAuth,
  requireLender,
  requireScopes('read:pool'),
  requireWalletParamMatchesJwt('address'),
  validate(getDepositorYieldHistorySchema),
  getDepositorYieldHistory,
);

/**
 * @swagger
 * /pool/{token}/share-price:
 *   get:
 *     summary: Get current on-chain share price for a pool token
 *     description: >
 *       Returns the current share price from the LendingPool contract.
 *       The value is scaled by 1,000,000 (e.g. 1,050,000 = 1.05 ratio).
 *       Cached briefly to absorb burst requests.
 *     tags: [Pool]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: Token address
 *     responses:
 *       200:
 *         description: Share price retrieved successfully
 *       401:
 *         description: Missing or invalid Bearer token
 */
router.get(
  '/:token/share-price',
  requireJwtAuth,
  requireLender,
  requireScopes('read:pool'),
  getPoolSharePrice,
);

/**
 * @swagger
 * /pool/build-deposit:
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
 *               - token
 *               - amount
 *             properties:
 *               depositorPublicKey:
 *                 type: string
 *                 description: Depositor's Stellar public key (must match JWT)
 *               token:
 *                 type: string
 *                 description: Address of the token to deposit
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
  '/build-deposit',
  requireJwtAuth,
  requireLender,
  requireScopes('write:pool'),
  validateBody(buildPoolTransactionSchema),
  idempotencyMiddleware,
  depositToPool,
);

/**
 * @swagger
 * /pool/build-withdraw:
 *   post:
 *     summary: Build an unsigned withdraw transaction
 *     description: >
 *       Builds an unsigned Soroban `withdraw(provider, token, shares, min_assets_out)` transaction XDR
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
 *               - token
 *               - amount
 *             properties:
 *               depositorPublicKey:
 *                 type: string
 *                 description: Depositor's Stellar public key (must match JWT)
 *               token:
 *                 type: string
 *                 description: Address of the token to withdraw
 *               amount:
 *                 type: number
 *                 description: Amount (shares) to withdraw
 *                 example: 500
 *               minAssetsOut:
 *                 type: number
 *                 description: Minimum underlying assets to receive (slippage bound, defaults to 0)
 *                 example: 490
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
  '/build-withdraw',
  requireJwtAuth,
  requireLender,
  requireScopes('write:pool'),
  validateBody(buildPoolTransactionSchema),
  idempotencyMiddleware,
  withdrawFromPool,
);

/**
 * @swagger
 * /pool/build-emergency-withdraw:
 *   post:
 *     summary: Build an unsigned emergency withdraw transaction
 *     description: >
 *       Builds an unsigned Soroban `emergency_withdraw(provider, token, shares, min_assets_out)`
 *       transaction XDR against the LendingPool contract. Bypasses the withdrawal
 *       cooldown. The frontend signs it with the user's wallet and submits via
 *       POST /api/pool/submit.
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
 *               - token
 *               - shares
 *             properties:
 *               depositorPublicKey:
 *                 type: string
 *                 description: Depositor's Stellar public key (must match JWT)
 *               token:
 *                 type: string
 *                 description: Address of the token to withdraw
 *               shares:
 *                 type: number
 *                 description: Amount (shares) to withdraw
 *               minAssetsOut:
 *                 type: number
 *                 description: Minimum underlying assets to receive (slippage bound, defaults to 0)
 *                 example: 490
 *     responses:
 *       200:
 *         description: Unsigned transaction XDR returned
 *       400:
 *         description: Validation error
 *       401:
 *         description: Missing or invalid Bearer token
 */
router.post(
  '/build-emergency-withdraw',
  requireJwtAuth,
  requireLender,
  requireScopes('write:pool'),
  validateBody(emergencyWithdrawSchema),
  idempotencyMiddleware,
  emergencyWithdrawFromPool,
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
  '/submit',
  requireJwtAuth,
  requireLender,
  requireScopes('write:pool'),
  validateBody(submitTxSchema),
  idempotencyMiddleware,
  submitPoolTransaction,
);

export default router;
