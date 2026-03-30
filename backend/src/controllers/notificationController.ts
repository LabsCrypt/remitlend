import { Request, Response } from "express";
import { notificationService } from "../services/notificationService.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { AppError } from "../errors/AppError.js";
import { parseCappedLimit } from "../utils/queryHelpers.js";
import logger from "../utils/logger.js";

/**
 * GET /api/notifications
 * Returns the authenticated user's notifications (newest first).
 * Optional query param: ?limit=N (default 50, max 100)
 */
export const getNotifications = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = req.user?.publicKey;
    if (!userId) throw AppError.unauthorized("Authentication required");

    const limit = parseCappedLimit(req, 50);

    const [notifications, unreadCount] = await Promise.all([
      notificationService.getNotificationsForUser(userId, limit),
      notificationService.getUnreadCount(userId),
    ]);

    res.json({ success: true, data: { notifications, unreadCount } });
  },
);

/**
 * POST /api/notifications/mark-read
 * Body: { ids: number[] }
 * Marks the specified notifications as read (only those owned by the caller).
 */
export const markRead = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.publicKey;
  if (!userId) throw AppError.unauthorized("Authentication required");

  const { ids } = req.body as { ids?: unknown };
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "number")) {
    throw AppError.badRequest("Body must contain an array of numeric ids");
  }

  await notificationService.markRead(userId, ids as number[]);
  res.json({ success: true });
});

/**
 * POST /api/notifications/mark-all-read
 * Marks every unread notification for the authenticated user as read.
 */
export const markAllRead = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.publicKey;
  if (!userId) throw AppError.unauthorized("Authentication required");

  await notificationService.markAllRead(userId);
  res.json({ success: true });
});

/**
 * GET /api/notifications/stream
 * Server-Sent Events endpoint for real-time notification push.
 * The client connects and keeps the connection open; whenever the user
 * receives a new notification the server pushes it as a JSON `data:` event.
 */
export const streamNotifications = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = req.user?.publicKey;
    if (!userId) throw AppError.unauthorized("Authentication required");

    // SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering
    res.flushHeaders();

    // Send a comment heartbeat every 30s to keep the connection alive through
    // load balancers and proxies.
    const heartbeat = setInterval(() => {
      try {
        res.write(": heartbeat\n\n");
      } catch {
        // client already gone
      }
    }, 30_000);

    // Send any unread notifications immediately on connect so the client
    // doesn't have to issue a separate GET.
    try {
      const notifications = await notificationService.getNotificationsForUser(
        userId,
        50,
      );
      const unread = notifications.filter((n) => !n.read);
      if (unread.length) {
        res.write(
          `data: ${JSON.stringify({ type: "init", notifications: unread })}\n\n`,
        );
      }
    } catch (err) {
      logger.error("SSE init fetch error", { userId, err });
    }

    const unsubscribe = notificationService.subscribe(userId, res);

    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };

    req.on("close", cleanup);
    req.on("error", cleanup);
  },
);
