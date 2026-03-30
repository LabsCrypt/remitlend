import { Router } from "express";
import { z } from "zod";
import { requireApiKey } from "../middleware/auth.js";
import { strictRateLimiter } from "../middleware/rateLimiter.js";
import { validateBody } from "../middleware/validation.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { auditLog } from "../middleware/auditLog.js";
import { defaultChecker } from "../services/defaultChecker.js";
import {
  createWebhookSubscription,
  deleteWebhookSubscription,
  getWebhookDeliveries,
  listWebhookSubscriptions,
  reindexLedgerRange,
} from "../controllers/indexerController.js";

const router = Router();

const checkDefaultsBodySchema = z.object({
  loanIds: z.array(z.number().int().positive()).optional(),
});

const liquidateCollateralBodySchema = z.object({
  loanId: z.number().int().positive(),
  saleProceeds: z.number().int().nonnegative(),
});

/**
 * @swagger
 * /admin/check-defaults:
 *   post:
 *     summary: Trigger on-chain default checks (admin)
 *     description: >
 *       Submits `check_defaults` to the LoanManager contract for either a specific
 *       list of loan IDs, or (if omitted) all loans that appear overdue based on
 *       indexed `LoanApproved` ledgers.
 *     tags: [Admin]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               loanIds:
 *                 type: array
 *                 items:
 *                   type: integer
 *     responses:
 *       200:
 *         description: Default check run completed (see batch errors in payload)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DefaultCheckResponse'
 */
router.post(
  "/check-defaults",
  requireApiKey,
  strictRateLimiter,
  auditLog,
  validateBody(checkDefaultsBodySchema),
  asyncHandler(async (req, res) => {
    const { loanIds } = req.body as z.infer<typeof checkDefaultsBodySchema>;
    const result = await defaultChecker.checkOverdueLoans(loanIds);

    res.json({
      success: true,
      data: result,
    });
  }),
);

/**
 * @swagger
 * /admin/liquidate-collateral:
 *   post:
 *     summary: Trigger collateral liquidation for a defaulted loan (admin)
 *     description: >
 *       Submits `liquidate_collateral(loan_id, sale_proceeds)` to the LoanManager
 *       contract. `sale_proceeds` is the realized off-chain auction/floor-sale amount
 *       that should be settled into the lending pool.
 *     tags: [Admin]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [loanId, saleProceeds]
 *             properties:
 *               loanId:
 *                 type: integer
 *               saleProceeds:
 *                 type: integer
 *                 minimum: 0
 *     responses:
 *       200:
 *         description: Liquidation submission completed
 */
router.post(
  "/liquidate-collateral",
  requireApiKey,
  strictRateLimiter,
  auditLog,
  validateBody(liquidateCollateralBodySchema),
  asyncHandler(async (req, res) => {
    const { loanId, saleProceeds } = req.body as z.infer<
      typeof liquidateCollateralBodySchema
    >;
    const result = await defaultChecker.liquidateCollateral(
      loanId,
      saleProceeds,
    );

    res.json({
      success: true,
      data: result,
    });
  }),
);

/**
 * @swagger
 * /admin/reindex:
 *   post:
 *     summary: Backfill/reindex contract events for a ledger range
 *     tags: [Admin]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: fromLedger
 *         required: true
 *         schema:
 *           type: integer
 *       - in: query
 *         name: toLedger
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Reindex completed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ReindexResponse'
 */
router.post(
  "/reindex",
  requireApiKey,
  strictRateLimiter,
  auditLog,
  reindexLedgerRange,
);

/**
 * @swagger
 * /admin/webhooks:
 *   post:
 *     summary: Register a webhook subscription
 *     tags: [Admin]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [callbackUrl, eventTypes]
 *             properties:
 *               callbackUrl:
 *                 type: string
 *               eventTypes:
 *                 type: array
 *                 items:
 *                   type: string
 *               secret:
 *                 type: string
 *     responses:
 *       201:
 *         description: Subscription created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/WebhookSubscriptionResponse'
 *   get:
 *     summary: List webhook subscriptions
 *     tags: [Admin]
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: List of subscriptions
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/WebhookSubscriptionListResponse'
 */
router.post(
  "/webhooks",
  requireApiKey,
  strictRateLimiter,
  auditLog,
  createWebhookSubscription,
);
router.get("/webhooks", requireApiKey, listWebhookSubscriptions);

/**
 * @swagger
 * /admin/webhooks/{id}:
 *   delete:
 *     summary: Remove a webhook subscription
 *     tags: [Admin]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Subscription deleted
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessMessageResponse'
 */
router.delete(
  "/webhooks/:id",
  requireApiKey,
  strictRateLimiter,
  auditLog,
  deleteWebhookSubscription,
);

/**
 * @swagger
 * /admin/webhooks/{id}/deliveries:
 *   get:
 *     summary: View webhook delivery history
 *     tags: [Admin]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: integer
 *           default: 50
 *     responses:
 *       200:
 *         description: Delivery history returned
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/WebhookDeliveriesResponse'
 */
router.get("/webhooks/:id/deliveries", requireApiKey, getWebhookDeliveries);

export default router;
