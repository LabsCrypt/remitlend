import { Router } from "express";
import {
  getIndexerStatus,
  getBorrowerEvents,
  getLoanEvents,
  getRecentEvents,
  listWebhookSubscriptions,
  createWebhookSubscription,
  deleteWebhookSubscription,
} from "../controllers/indexerController.js";
import { requireApiKey } from "../middleware/auth.js";
import {
  requireJwtAuth,
  requireScopes,
  requireWalletOwnership,
} from "../middleware/jwtAuth.js";
import { requireLoanBorrowerAccess } from "../middleware/loanAccess.js";

const router = Router();

/**
 * @swagger
 * /indexer/status:
 *   get:
 *     summary: Get indexer status
 *     description: Returns the current state of the event indexer including last indexed ledger and event counts
 *     tags: [Indexer]
 *     responses:
 *       200:
 *         description: Indexer status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/IndexerStatusResponse'
 */
router.get("/status", getIndexerStatus);

/**
 * @swagger
 * /indexer/events/borrower/{borrower}:
 *   get:
 *     summary: Get events for a specific borrower
 *     description: >
 *       Returns loan events for the authenticated wallet; `borrower` must match
 *       the JWT Stellar public key.
 *     tags: [Indexer]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: borrower
 *         required: true
 *         schema:
 *           type: string
 *         description: Borrower's Stellar address
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: Events retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/BorrowerEventsResponse'
 *       401:
 *         description: Missing or invalid Bearer token
 *       403:
 *         description: borrower does not match authenticated wallet
 */
router.get(
  "/events/borrower/:borrower",
  requireJwtAuth,
  requireScopes("read:loans"),
  requireWalletOwnership,
  getBorrowerEvents,
);

/**
 * @swagger
 * /indexer/events/loan/{loanId}:
 *   get:
 *     summary: Get events for a specific loan
 *     description: >
 *       Returns events only if the authenticated wallet is the borrower for that loan.
 *     tags: [Indexer]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: loanId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Loan ID
 *     responses:
 *       200:
 *         description: Events retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LoanEventsResponse'
 *       401:
 *         description: Missing or invalid Bearer token
 *       404:
 *         description: Loan not found or not accessible
 */
router.get(
  "/events/loan/:loanId",
  requireJwtAuth,
  requireScopes("read:loans"),
  requireLoanBorrowerAccess,
  getLoanEvents,
);

/**
 * @swagger
 * /indexer/events/recent:
 *   get:
 *     summary: Get recent events
 *     description: >
 *       Internal/admin use: requires `x-api-key` (`INTERNAL_API_KEY`). Returns the
 *       most recent loan events, optionally filtered by event type.
 *     tags: [Indexer]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: eventType
 *         schema:
 *           type: string
 *           enum: [LoanRequested, LoanApproved, LoanRepaid, LoanDefaulted]
 *     responses:
 *       200:
 *         description: Events retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/RecentEventsResponse'
 *       401:
 *         description: Missing or invalid API key
 */
router.get("/events/recent", requireApiKey, getRecentEvents);

/**
 * @swagger
 * /indexer/webhooks:
 *   get:
 *     summary: List webhook subscriptions
 *     tags: [Indexer]
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Webhook subscriptions retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/WebhookSubscriptionListResponse'
 *       401:
 *         description: Missing or invalid API key
 */
router.get("/webhooks", requireApiKey, listWebhookSubscriptions);

/**
 * @swagger
 * /indexer/webhooks:
 *   post:
 *     summary: Register a webhook subscription
 *     tags: [Indexer]
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
 *                   enum: [LoanRequested, LoanApproved, LoanRepaid, LoanDefaulted]
 *               secret:
 *                 type: string
 *     responses:
 *       201:
 *         description: Webhook subscription created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/WebhookSubscriptionResponse'
 *       401:
 *         description: Missing or invalid API key
 */
router.post("/webhooks", requireApiKey, createWebhookSubscription);


/**
 * @swagger
 * /indexer/webhooks/{subscriptionId}:
 *   delete:
 *     summary: Delete a webhook subscription
 *     tags: [Indexer]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: subscriptionId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Webhook subscription deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessMessageResponse'
 *       401:
 *         description: Missing or invalid API key
 */
router.delete(
  "/webhooks/:subscriptionId",
  requireApiKey,
  deleteWebhookSubscription,
);

export default router;
