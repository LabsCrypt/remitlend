import { Router } from "express";
import {
  getUserNotificationPreferences,
  updateUserNotificationPreferences,
  testNotificationSettings,
} from "../controllers/notificationController.js";

const router = Router();

// Get user notification preferences
router.get("/preferences", getUserNotificationPreferences);

// Update user notification preferences
router.put("/preferences", updateUserNotificationPreferences);

// Test notification settings
router.post("/test", testNotificationSettings);

export default router;
