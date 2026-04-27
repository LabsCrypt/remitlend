import { Router } from "express";
import { z } from "zod";
import { requireApiKey } from "../middleware/auth.js";
import { strictRateLimiter } from "../middleware/rateLimiter.js";
import { validateBody } from "../middleware/validation.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { auditLog } from "../middleware/auditLog.js";
import { defaultChecker } from "../services/defaultChecker.js";
import {
  createWebhookSubscription,
  deleteWebhookSubscription,
  getWebhookDeliveries,
  listQuarantinedEvents,
  listWebhookSubscriptions,
  reprocessQuarantinedEvents,
  reindexLedgerRange,
} from "../controllers/indexerController.js";
import { listLoanDisputes, resolveLoanDispute } from "../controllers/adminDisputeController.js";
import { query } from "../db/connection.js";

const router = Router();

/**
 * @swagger
 * /admin/loan-disputes:
 *   get:
 *     summary: List open loan disputes
 *     tags: [Admin]
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: List of open disputes
 *
 * /admin/loan-disputes/{disputeId}/resolve:
 *   post:
 *     summary: Resolve a loan dispute (confirm or reverse default)
 *     tags: [Admin]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: disputeId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - action
 *               - resolution
 *             properties:
 *               action:
 *                 type: string
 *                 enum: [confirm, reverse]
 *                 description: Action to take
 *               resolution:
 *                 type: string
 *                 description: Reason for resolution
 *     responses:
 *       200:
 *         description: Dispute resolved
 */
router.get("/loan-disputes", requireApiKey, listLoanDisputes);
router.post("/loan-disputes/:disputeId/resolve", requireApiKey, resolveLoanDispute);

const checkDefaultsBodySchema = z.object({
  loanIds: z.array(z.number().int().positive()).max(100).optional(),
});

/**
 * @swagger
 * /admin/check-defaults:
 *   post:
 *     summary: Trigger manual on-chain default checks for a set of loans
 *     description: >
 *       Calls the LoanManager `check_defaults` contract function for the
 *       provided loan IDs (or all overdue loans if IDs are omitted).
 *       Bounded to a maximum of 100 IDs per request for security.
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
 *                 maxItems: 100
 *                 description: Explicit list of loan IDs to check
 *     responses:
 *       200:
 *         description: Default check run completed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DefaultCheckRunResult'
 *       400:
 *         description: Validation error or too many IDs
 */
router.post(
  "/check-defaults",
  requireApiKey,
  strictRateLimiter,
  auditLog,
  validateBody(checkDefaultsBodySchema),
  asyncHandler(async (req, res) => {
    const result = await defaultChecker.checkOverdueLoans(req.body.loanIds);
    res.json(result);
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
 * /admin/quarantine-events:
 *   get:
 *     summary: List quarantined indexer events
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
 *       - in: query
 *         name: cursor
 *         required: false
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Quarantined events retrieved
 */
router.get("/quarantine-events", requireApiKey, listQuarantinedEvents);

/**
 * @swagger
 * /admin/quarantine-events/reprocess:
 *   post:
 *     summary: Reprocess quarantined indexer events
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
 *               ids:
 *                 type: array
 *                 items:
 *                   type: integer
 *               limit:
 *                 type: integer
 *                 default: 50
 *     responses:
 *       200:
 *         description: Reprocess attempt completed
 */
router.post(
  "/quarantine-events/reprocess",
  requireApiKey,
  strictRateLimiter,
  auditLog,
  reprocessQuarantinedEvents,
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

/**
 * @swagger
 * /admin/webhooks/retry-status:
 *   get:
 *     summary: Get status of failed webhooks and retry queue
 *     tags: [Admin]
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Retry status information
 */
router.get(
  "/webhooks/retry-status",
  requireApiKey,
  asyncHandler(async (req, res) => {
    const result = await query(`
      SELECT 
        COUNT(*) as total_failed,
        COUNT(*) FILTER (WHERE attempt_count >= 5) as permanently_failed,
        COUNT(*) FILTER (WHERE next_retry_at IS NOT NULL) as pending_retry
      FROM webhook_deliveries
      WHERE delivered_at IS NULL
    `);
    
    res.json(result.rows[0]);
  })
);

export default router;
