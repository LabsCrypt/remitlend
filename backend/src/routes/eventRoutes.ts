import { Router } from "express";
import {
  streamEvents,
  getEventStreamStatus,
} from "../controllers/eventStreamController.js";
import { requireJwtAuth } from "../middleware/jwtAuth.js";
import { requireApiKey } from "../middleware/auth.js";

const router = Router();

/**
 * @swagger
 * /events/stream:
 *   get:
 *     summary: SSE stream for real-time loan events
 *     description: >
 *       Server-Sent Events endpoint for real-time loan event push.
 *       Auth is provided via Authorization bearer token or JWT cookie.
 *       Borrowers receive only their own events; optional `?borrower=G...`
 *       must match the authenticated wallet.
 *       Admin users receive all events when borrower is omitted.
 *       Supports replay on reconnect via `Last-Event-ID` header.
 *       Frontend can use the EventSource API for automatic reconnection.
 *     tags: [Events]
 *     security:
 *       - BearerAuth: []
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: borrower
 *         schema:
 *           type: string
 *         description: >
 *           Borrower's Stellar address. When provided, only events for this
 *           borrower are streamed (JWT must match). When omitted, all events
 *           are streamed (API key required).
 *       - in: header
 *         name: Last-Event-ID
 *         schema:
 *           type: string
 *         description: >
 *           The ID of the last processed SSE event; server replays newer
 *           events on reconnect.
 *     responses:
 *       200:
 *         description: Server-Sent Events stream (text/event-stream)
 *         content:
 *           text/event-stream:
 *             schema:
 *               $ref: '#/components/schemas/ServerSentEventStream'
 *       401:
 *         description: Missing or invalid authentication
 */
router.get("/stream", requireJwtAuth, streamEvents);

/**
 * @swagger
 * /events/status:
 *   get:
 *     summary: Get SSE connection counts
 *     description: >
 *       Returns current SSE connection statistics. Requires API key.
 *     tags: [Events]
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Connection counts retrieved
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/EventStreamStatusResponse'
 *       401:
 *         description: Missing or invalid API key
 */
router.get("/status", requireApiKey, getEventStreamStatus);

export default router;
