import { Router } from "express";
import {
  getPoolStats,
  getDepositorPortfolio,
} from "../controllers/poolController.js";
import {
  requireLender,
  requireJwtAuth,
  requireScopes,
  requireWalletParamMatchesJwt,
} from "../middleware/jwtAuth.js";
import { validate } from "../middleware/validation.js";
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

export default router;
