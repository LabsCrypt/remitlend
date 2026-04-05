import { Request, Response } from "express";
import { z } from "zod";
import {
  NotificationPreferencesService,
  UpdateNotificationPreferencesDTO,
} from "../services/notificationPreferencesService.js";
import {
  ExternalNotificationService,
  ExternalNotificationEvent,
} from "../services/externalNotificationService.js";
import { NotificationSchedulerService } from "../services/notificationSchedulerService.js";
import logger from "../utils/logger.js";
import { verifyJwtToken } from "../services/authService.js";

const preferencesService = NotificationPreferencesService.getInstance();
const notificationService = ExternalNotificationService.getInstance();
const schedulerService = NotificationSchedulerService.getInstance();

// Request/Response schemas
const updatePreferencesSchema = z.object({
  email: z
    .object({
      enabled: z.boolean().optional(),
      loanStatusUpdates: z.boolean().optional(),
      paymentReminders: z.boolean().optional(),
      paymentOverdue: z.boolean().optional(),
      loanDisbursement: z.boolean().optional(),
      marketing: z.boolean().optional(),
      accountAlerts: z.boolean().optional(),
    })
    .optional(),
  sms: z
    .object({
      enabled: z.boolean().optional(),
      loanStatusUpdates: z.boolean().optional(),
      paymentReminders: z.boolean().optional(),
      paymentOverdue: z.boolean().optional(),
      loanDisbursement: z.boolean().optional(),
      marketing: z.boolean().optional(),
      accountAlerts: z.boolean().optional(),
      useWhatsApp: z.boolean().optional(),
    })
    .optional(),
  timezone: z.string().optional(),
  language: z.string().optional(),
});

const updateContactInfoSchema = z.object({
  email: z.string().email().optional(),
  phone: z
    .string()
    .regex(/^\+?[\d\s\-\(\)]+$/)
    .optional(),
});

const sendTestNotificationSchema = z.object({
  type: z.enum(["loan_status_update", "payment_reminder", "account_alert"]),
  channel: z.enum(["email", "sms", "both"]),
});

export class ExternalNotificationController {
  // Get user's notification preferences
  async getPreferences(req: Request, res: Response): Promise<void> {
    try {
      const token = req.headers.authorization?.replace("Bearer ", "");
      if (!token) {
        res
          .status(401)
          .json({ success: false, message: "Authorization token required" });
        return;
      }

      const decoded = verifyJwtToken(token);
      if (!decoded) {
        res.status(401).json({ success: false, message: "Invalid token" });
        return;
      }

      const preferences = await preferencesService.getPreferences(
        decoded.publicKey,
      );

      if (!preferences) {
        // Create default preferences if none exist
        const defaultPrefs = await preferencesService.createDefaultPreferences(
          decoded.publicKey,
        );
        res.json({ success: true, data: defaultPrefs });
        return;
      }

      res.json({ success: true, data: preferences });
    } catch (error) {
      logger.error("Error getting notification preferences:", error);
      res.status(500).json({
        success: false,
        message: "Failed to retrieve notification preferences",
      });
    }
  }

  // Update user's notification preferences
  async updatePreferences(req: Request, res: Response): Promise<void> {
    try {
      const token = req.headers.authorization?.replace("Bearer ", "");
      if (!token) {
        res
          .status(401)
          .json({ success: false, message: "Authorization token required" });
        return;
      }

      const decoded = verifyJwtToken(token);
      if (!decoded) {
        res.status(401).json({ success: false, message: "Invalid token" });
        return;
      }

      const validatedData = updatePreferencesSchema.parse(req.body);

      const updatedPreferences = await preferencesService.updatePreferences(
        decoded.publicKey,
        validatedData as UpdateNotificationPreferencesDTO,
      );

      logger.info("Notification preferences updated", {
        userId: decoded.publicKey,
      });
      res.json({ success: true, data: updatedPreferences });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          message: "Invalid request data",
          errors: error.issues,
        });
        return;
      }

      logger.error("Error updating notification preferences:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update notification preferences",
      });
    }
  }

  // Update user's contact information
  async updateContactInfo(req: Request, res: Response): Promise<void> {
    try {
      const token = req.headers.authorization?.replace("Bearer ", "");
      if (!token) {
        res
          .status(401)
          .json({ success: false, message: "Authorization token required" });
        return;
      }

      const decoded = verifyJwtToken(token);
      if (!decoded) {
        res.status(401).json({ success: false, message: "Invalid token" });
        return;
      }

      const validatedData = updateContactInfoSchema.parse(req.body);

      await preferencesService.updateContactInfo(
        decoded.publicKey,
        validatedData.email,
        validatedData.phone,
      );

      logger.info("Contact information updated", {
        userId: decoded.publicKey,
        hasEmail: !!validatedData.email,
        hasPhone: !!validatedData.phone,
      });

      res.json({
        success: true,
        message: "Contact information updated successfully",
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          message: "Invalid request data",
          errors: error.issues,
        });
        return;
      }

      logger.error("Error updating contact information:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update contact information",
      });
    }
  }

  // Send a test notification
  async sendTestNotification(req: Request, res: Response): Promise<void> {
    try {
      const token = req.headers.authorization?.replace("Bearer ", "");
      if (!token) {
        res
          .status(401)
          .json({ success: false, message: "Authorization token required" });
        return;
      }

      const decoded = verifyJwtToken(token);
      if (!decoded) {
        res.status(401).json({ success: false, message: "Invalid token" });
        return;
      }

      const validatedData = sendTestNotificationSchema.parse(req.body);

      const contactInfo = await preferencesService.getUserContactInfo(
        decoded.publicKey,
      );
      if (!contactInfo) {
        res.status(404).json({
          success: false,
          message: "User contact information not found",
        });
        return;
      }

      // Create test notification
      const testEvent: ExternalNotificationEvent = {
        type: validatedData.type,
        userId: decoded.publicKey,
        data: {
          borrowerName: 'Test User',
          loanId: 'TEST-123',
          amount: '1000',
          currency: 'USD',
          dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
            .toISOString()
            .split('T')[0],
        } as ExternalNotificationEvent['data'],
        priority: 'low',
      };

      if (validatedData.type === 'account_alert') {
        (testEvent.data as any).alertType = 'login';
        (testEvent.data as any).details = 'Test notification from RemitLend';
      }

      const result = await notificationService.sendNotification(testEvent);

      logger.info("Test notification sent", {
        userId: decoded.publicKey,
        type: validatedData.type,
        channel: validatedData.channel,
        success: result.success,
      });

      res.json({
        success: true,
        data: {
          message: "Test notification sent",
          emailSent: result.emailSent,
          smsSent: result.smsSent,
          errors: result.errors,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          message: "Invalid request data",
          errors: error.issues,
        });
        return;
      }

      logger.error("Error sending test notification:", error);
      res
        .status(500)
        .json({ success: false, message: "Failed to send test notification" });
    }
  }

  // Get notification service status
  async getServiceStatus(req: Request, res: Response): Promise<void> {
    try {
      const serviceStatus = notificationService.getServiceStatus();
      const schedulerStatus = schedulerService.getSchedulerStatus();
      const stats = await preferencesService.getNotificationStats();

      res.json({
        success: true,
        data: {
          services: serviceStatus,
          scheduler: schedulerStatus,
          statistics: stats,
        },
      });
    } catch (error) {
      logger.error("Error getting service status:", error);
      res
        .status(500)
        .json({ success: false, message: "Failed to retrieve service status" });
    }
  }

  // Test notification services (admin only)
  async testServices(req: Request, res: Response): Promise<void> {
    try {
      const token = req.headers.authorization?.replace("Bearer ", "");
      if (!token) {
        res
          .status(401)
          .json({ success: false, message: "Authorization token required" });
        return;
      }

      const decoded = verifyJwtToken(token);
      if (!decoded) {
        res.status(401).json({ success: false, message: "Invalid token" });
        return;
      }

      const testResults = await notificationService.testNotificationServices();

      logger.info("Notification services tested", {
        userId: decoded.publicKey,
        results: testResults,
      });

      res.json({
        success: true,
        data: testResults,
      });
    } catch (error) {
      logger.error("Error testing notification services:", error);
      res.status(500).json({
        success: false,
        message: "Failed to test notification services",
      });
    }
  }

  // Get notification logs for user
  async getNotificationLogs(req: Request, res: Response): Promise<void> {
    try {
      const token = req.headers.authorization?.replace("Bearer ", "");
      if (!token) {
        res
          .status(401)
          .json({ success: false, message: "Authorization token required" });
        return;
      }

      const decoded = verifyJwtToken(token);
      if (!decoded) {
        res.status(401).json({ success: false, message: "Invalid token" });
        return;
      }

      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;

      // This would need to be implemented in the preferences service
      // For now, return a placeholder response
      res.json({
        success: true,
        data: {
          logs: [],
          total: 0,
          limit,
          offset,
        },
      });
    } catch (error) {
      logger.error("Error getting notification logs:", error);
      res.status(500).json({
        success: false,
        message: "Failed to retrieve notification logs",
      });
    }
  }

  // Delete user's notification preferences
  async deletePreferences(req: Request, res: Response): Promise<void> {
    try {
      const token = req.headers.authorization?.replace("Bearer ", "");
      if (!token) {
        res
          .status(401)
          .json({ success: false, message: "Authorization token required" });
        return;
      }

      const decoded = verifyJwtToken(token);
      if (!decoded) {
        res.status(401).json({ success: false, message: "Invalid token" });
        return;
      }

      await preferencesService.deletePreferences(decoded.publicKey);

      logger.info("Notification preferences deleted", {
        userId: decoded.publicKey,
      });
      res.json({
        success: true,
        message: "Notification preferences deleted successfully",
      });
    } catch (error) {
      logger.error("Error deleting notification preferences:", error);
      res.status(500).json({
        success: false,
        message: "Failed to delete notification preferences",
      });
    }
  }

  // Trigger scheduler tasks (admin only)
  async triggerSchedulerTask(req: Request, res: Response): Promise<void> {
    try {
      const token = req.headers.authorization?.replace("Bearer ", "");
      if (!token) {
        res
          .status(401)
          .json({ success: false, message: "Authorization token required" });
        return;
      }

      const decoded = verifyJwtToken(token);
      if (!decoded) {
        res.status(401).json({ success: false, message: "Invalid token" });
        return;
      }

      const { task } = req.body as { task?: string };

      switch (task) {
        case "payment_reminders":
          await schedulerService.triggerPaymentReminderCheck();
          break;
        case "overdue_payments":
          await schedulerService.triggerOverduePaymentCheck();
          break;
        case "daily_summary":
          await schedulerService.triggerDailySummary();
          break;
        case "weekly_engagement":
          await schedulerService.triggerWeeklyEngagement();
          break;
        default:
          res
            .status(400)
            .json({ success: false, message: "Invalid task name" });
          return;
      }

      logger.info("Scheduler task triggered", {
        userId: decoded.publicKey,
        task,
      });
      res.json({
        success: true,
        message: `Scheduler task '${task}' triggered successfully`,
      });
    } catch (error) {
      logger.error("Error triggering scheduler task:", error);
      res
        .status(500)
        .json({ success: false, message: "Failed to trigger scheduler task" });
    }
  }

  // Get scheduler status (admin only)
  async getSchedulerStatus(req: Request, res: Response): Promise<void> {
    try {
      const token = req.headers.authorization?.replace("Bearer ", "");
      if (!token) {
        res
          .status(401)
          .json({ success: false, message: "Authorization token required" });
        return;
      }

      const decoded = verifyJwtToken(token);
      if (!decoded) {
        res.status(401).json({ success: false, message: "Invalid token" });
        return;
      }

      const status = schedulerService.getSchedulerStatus();

      res.json({
        success: true,
        data: status,
      });
    } catch (error) {
      logger.error("Error getting scheduler status:", error);
      res.status(500).json({
        success: false,
        message: "Failed to retrieve scheduler status",
      });
    }
  }
}
