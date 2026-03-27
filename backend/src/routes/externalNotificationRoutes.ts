import { Router } from "express";
import { ExternalNotificationController } from "../controllers/externalNotificationController.js";
import { asyncHandler } from "../middleware/asyncHandler.js";

const router = Router();
const controller = new ExternalNotificationController();

// User notification preferences routes
router.get(
  "/preferences",
  asyncHandler(controller.getPreferences.bind(controller)),
);
router.put(
  "/preferences",
  asyncHandler(controller.updatePreferences.bind(controller)),
);
router.delete(
  "/preferences",
  asyncHandler(controller.deletePreferences.bind(controller)),
);

// Contact information routes
router.put(
  "/contact",
  asyncHandler(controller.updateContactInfo.bind(controller)),
);

// Test notification
router.post(
  "/test",
  asyncHandler(controller.sendTestNotification.bind(controller)),
);

// Notification logs
router.get(
  "/logs",
  asyncHandler(controller.getNotificationLogs.bind(controller)),
);

// Service status (public)
router.get(
  "/status",
  asyncHandler(controller.getServiceStatus.bind(controller)),
);

// Admin-only routes
router.post(
  "/test-services",
  asyncHandler(controller.testServices.bind(controller)),
);
router.post(
  "/scheduler/trigger",
  asyncHandler(controller.triggerSchedulerTask.bind(controller)),
);
router.get(
  "/scheduler/status",
  asyncHandler(controller.getSchedulerStatus.bind(controller)),
);

export default router;
