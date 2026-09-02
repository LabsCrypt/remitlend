import { Router } from 'express';
import {
  getNotifications,
  getNotificationPreferences,
  markRead,
  markAllRead,
  streamNotifications,
  updateNotificationPreferences,
} from '../controllers/notificationController.js';
import { requireJwtAuth, requireScopes } from '../middleware/jwtAuth.js';
import { validateQuery } from '../middleware/validation.js';
import { getNotificationsQuerySchema } from '../schemas/notificationSchemas.js';

const router = Router();

/**
 * @swagger
 * /notifications:
 *   get:
 *     summary: Get notifications for the authenticated user
 *     description: >
 *       Returns a paginated list of notifications for the authenticated user.
 *       Supports filtering by type, status, and date range.
 *     tags: [Notifications]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *           maximum: 100
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [loan_approved, repayment_due, repayment_confirmed, loan_defaulted, loan_liquidated, score_changed]
 *         description: Filter by notification type
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [unread, read, archived]
 *         description: Filter by notification status
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter by created_at start date (ISO-8601)
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter by created_at end date (ISO-8601)
 *     responses:
 *       200:
 *         description: List of notifications and unread count
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/NotificationsResponse'
 */
router.get(
  '/',
  requireJwtAuth,
  requireScopes('read:notifications'),
  validateQuery(getNotificationsQuerySchema),
  getNotifications,
);

/**
 * @swagger
 * /notifications/preferences:
 *   get:
 *     summary: Get notification delivery preferences for the authenticated user
 *     tags: [Notifications]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Notification preference values
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/NotificationPreferences'
 */
router.get('/preferences', requireJwtAuth, getNotificationPreferences);

/**
 * @swagger
 * /notifications/preferences:
 *   put:
 *     summary: Update notification delivery preferences for the authenticated user
 *     tags: [Notifications]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/NotificationPreferences'
 *     responses:
 *       200:
 *         description: Updated notification preference values
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/NotificationPreferences'
 */
router.put('/preferences', requireJwtAuth, updateNotificationPreferences);

/**
 * @swagger
 * /notifications/stream:
 *   get:
 *     summary: SSE stream for real-time notification push
 *     description: >
 *       Server-Sent Events stream for pushing real-time notifications to the client.
 *       Auth MUST be provided via the Authorization: Bearer <token> header.
 *       Frontend should use fetch with ReadableStream to support headers.
 *     tags: [Notifications]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Server-Sent Events stream (text/event-stream)
 *         content:
 *           text/event-stream:
 *             schema:
 *               $ref: '#/components/schemas/ServerSentEventStream'
 */
router.get('/stream', requireJwtAuth, requireScopes('read:notifications'), streamNotifications);

/**
 * @swagger
 * /notifications/mark-read:
 *   post:
 *     summary: Mark specific notifications as read
 *     tags: [Notifications]
 *     security:
 *       - BearerAuth: []
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
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SimpleSuccessResponse'
 */
router.post('/mark-read', requireJwtAuth, requireScopes('write:notifications'), markRead);

/**
 * @swagger
 * /notifications/mark-all-read:
 *   post:
 *     summary: Mark all notifications as read
 *     tags: [Notifications]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: All notifications marked as read
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SimpleSuccessResponse'
 */
router.post('/mark-all-read', requireJwtAuth, requireScopes('write:notifications'), markAllRead);

export default router;
