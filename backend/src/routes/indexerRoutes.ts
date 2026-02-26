import { Router } from "express";
import {
  getIndexerStatus,
  getBorrowerEvents,
  getLoanEvents,
  getRecentEvents,
} from "../controllers/indexerController.js";

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
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     lastIndexedLedger:
 *                       type: integer
 *                     lastIndexedCursor:
 *                       type: string
 *                     lastUpdated:
 *                       type: string
 *                       format: date-time
 *                     totalEvents:
 *                       type: integer
 *                     eventsByType:
 *                       type: object
 */
router.get("/status", getIndexerStatus);

/**
 * @swagger
 * /indexer/events/borrower/{borrower}:
 *   get:
 *     summary: Get events for a specific borrower
 *     description: Returns all loan events associated with a borrower address
 *     tags: [Indexer]
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
 */
router.get("/events/borrower/:borrower", getBorrowerEvents);

/**
 * @swagger
 * /indexer/events/loan/{loanId}:
 *   get:
 *     summary: Get events for a specific loan
 *     description: Returns all events associated with a loan ID
 *     tags: [Indexer]
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
 */
router.get("/events/loan/:loanId", getLoanEvents);

/**
 * @swagger
 * /indexer/events/recent:
 *   get:
 *     summary: Get recent events
 *     description: Returns the most recent loan events, optionally filtered by event type
 *     tags: [Indexer]
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
 *           enum: [LoanRequested, LoanApproved, LoanRepaid]
 *     responses:
 *       200:
 *         description: Events retrieved successfully
 */
router.get("/events/recent", getRecentEvents);

export default router;
