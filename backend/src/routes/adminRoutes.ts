import { Router } from "express";
import { z } from "zod";
import { requireApiKey } from "../middleware/auth.js";
import { strictRateLimiter } from "../middleware/rateLimiter.js";
import { validateBody } from "../middleware/validation.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { defaultChecker } from "../services/defaultChecker.js";
import {
  createWebhookSubscription,
  deleteWebhookSubscription,
  getWebhookDeliveries,
  getWebhookRetryQueue,
  listWebhookSubscriptions,
  reindexLedgerRange,
} from "../controllers/indexerController.js";

const router = Router();

const checkDefaultsBodySchema = z.object({
  loanIds: z.array(z.number().int().positive()).optional(),
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
router.post("/reindex", requireApiKey, strictRateLimiter, reindexLedgerRange);

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

/**
 * @swagger
 * /admin/webhooks/retry-queue:
 *   get:
 *     summary: View pending webhook retries
 *     tags: [Admin]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: integer
 *           default: 50
 *     responses:
 *       200:
 *         description: Retry queue returned
 */
router.get("/webhooks/retry-queue", requireApiKey, getWebhookRetryQueue);

export default router;
