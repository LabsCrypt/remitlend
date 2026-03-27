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
 *       Use `?borrower=G...` to receive events for a specific borrower
 *       (JWT required, must match borrower). Without the borrower param,
 *       streams all events (requires API key for admin access).
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
 *       - in: query
 *         name: token
 *         schema:
 *           type: string
 *         description: >
 *           JWT token (alternative to Authorization header for EventSource API
 *           which cannot set custom headers).
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
