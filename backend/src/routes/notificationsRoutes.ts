import { Router } from "express";
import {
  getNotifications,
  markRead,
  markAllRead,
  streamNotifications,
} from "../controllers/notificationController.js";
import { requireJwtAuth, requireScopes } from "../middleware/jwtAuth.js";

const router = Router();

/**
 * @swagger
 * /notifications:
 *   get:
 *     summary: Get notifications for the authenticated user
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *           maximum: 100
 *     responses:
 *       200:
 *         description: List of notifications and unread count
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
 *                     notifications:
 *                       type: array
 *                     unreadCount:
 *                       type: integer
 */
router.get(
  "/",
  requireJwtAuth,
  requireScopes("read:notifications"),
  getNotifications,
);

/**
 * @swagger
 * /notifications/stream:
 *   get:
 *     summary: SSE stream for real-time notification push
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Server-Sent Events stream (text/event-stream)
 */
router.get(
  "/stream",
  requireJwtAuth,
  requireScopes("read:notifications"),
  streamNotifications,
);

/**
 * @swagger
 * /notifications/mark-read:
 *   post:
 *     summary: Mark specific notifications as read
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               ids:
 *                 type: array
 *                 items:
 *                   type: integer
 *     responses:
 *       200:
 *         description: Notifications marked as read
 */
router.post(
  "/mark-read",
  requireJwtAuth,
  requireScopes("write:notifications"),
  markRead,
);

/**
 * @swagger
 * /notifications/mark-all-read:
 *   post:
 *     summary: Mark all notifications as read
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: All notifications marked as read
 */
router.post(
  "/mark-all-read",
  requireJwtAuth,
  requireScopes("write:notifications"),
  markAllRead,
);

export default router;
