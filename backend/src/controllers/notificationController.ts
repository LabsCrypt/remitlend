import { Request, Response } from "express";
import { query } from "../db/connection.js";
import { verifyJwtToken } from "../services/authService.js";
import logger from "../utils/logger.js";

export interface NotificationPreferences {
  email: string;
  phoneNumber?: string;
  emailEnabled: boolean;
  smsEnabled: boolean;
  whatsappEnabled: boolean;
}

export interface UpdateNotificationPreferencesInput {
  email?: string;
  phoneNumber?: string;
  emailEnabled?: boolean;
  smsEnabled?: boolean;
  whatsappEnabled?: boolean;
}

export const getUserNotificationPreferences = async (req: Request, res: Response) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authentication token required",
      });
    }

    const payload = verifyJwtToken(token);
    if (!payload) {
      return res.status(401).json({
        success: false,
        message: "Invalid authentication token",
      });
    }

    const result = await query(
      `SELECT 
        email,
        phone_number,
        email_notifications_enabled,
        sms_notifications_enabled,
        whatsapp_notifications_enabled
      FROM user_profiles
      WHERE public_key = $1`,
      [payload.publicKey],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User profile not found",
      });
    }

    const row = result.rows[0];
    const preferences: NotificationPreferences = {
      email: row.email,
      phoneNumber: row.phone_number,
      emailEnabled: row.email_notifications_enabled,
      smsEnabled: row.sms_notifications_enabled,
      whatsappEnabled: row.whatsapp_notifications_enabled,
    };

    res.json({
      success: true,
      data: preferences,
    });
  } catch (error) {
    logger.error("Failed to get user notification preferences", { error });
    res.status(500).json({
      success: false,
      message: "Failed to fetch notification preferences",
    });
  }
};

export const updateUserNotificationPreferences = async (req: Request, res: Response) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authentication token required",
      });
    }

    const payload = verifyJwtToken(token);
    if (!payload) {
      return res.status(401).json({
        success: false,
        message: "Invalid authentication token",
      });
    }

    const input: UpdateNotificationPreferencesInput = req.body;

    // Validate input
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (input.email !== undefined) {
      updates.push(`email = $${paramIndex++}`);
      values.push(input.email);
    }

    if (input.phoneNumber !== undefined) {
      updates.push(`phone_number = $${paramIndex++}`);
      values.push(input.phoneNumber);
    }

    if (input.emailEnabled !== undefined) {
      updates.push(`email_notifications_enabled = $${paramIndex++}`);
      values.push(input.emailEnabled);
    }

    if (input.smsEnabled !== undefined) {
      updates.push(`sms_notifications_enabled = $${paramIndex++}`);
      values.push(input.smsEnabled);
    }

    if (input.whatsappEnabled !== undefined) {
      updates.push(`whatsapp_notifications_enabled = $${paramIndex++}`);
      values.push(input.whatsappEnabled);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid fields to update",
      });
    }

    // Add updated_at timestamp and user public key
    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(payload.publicKey);

    const queryText = `
      UPDATE user_profiles
      SET ${updates.join(", ")}
      WHERE public_key = $${paramIndex}
      RETURNING 
        email,
        phone_number,
        email_notifications_enabled,
        sms_notifications_enabled,
        whatsapp_notifications_enabled
    `;

    const result = await query(queryText, values);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User profile not found",
      });
    }

    const row = result.rows[0];
    const preferences: NotificationPreferences = {
      email: row.email,
      phoneNumber: row.phone_number,
      emailEnabled: row.email_notifications_enabled,
      smsEnabled: row.sms_notifications_enabled,
      whatsappEnabled: row.whatsapp_notifications_enabled,
    };

    logger.info("User notification preferences updated", { 
      publicKey: payload.publicKey,
      preferences 
    });

    res.json({
      success: true,
      data: preferences,
      message: "Notification preferences updated successfully",
    });
  } catch (error) {
    logger.error("Failed to update user notification preferences", { error });
    res.status(500).json({
      success: false,
      message: "Failed to update notification preferences",
    });
  }
};

export const createUserProfileIfNeeded = async (stellarPublicKey: string): Promise<void> => {
  try {
    const existingProfile = await query(
      "SELECT public_key FROM user_profiles WHERE public_key = $1",
      [stellarPublicKey],
    );

    if (existingProfile.rows.length === 0) {
      await query(
        `INSERT INTO user_profiles (
          public_key,
          email_notifications_enabled,
          sms_notifications_enabled,
          whatsapp_notifications_enabled,
          created_at,
          updated_at
        ) VALUES ($1, true, false, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [stellarPublicKey],
      );

      logger.info("Created default user profile", { stellarPublicKey });
    }
  } catch (error) {
    logger.error("Failed to create user profile", { error, stellarPublicKey });
    throw error;
  }
};

export const testNotificationSettings = async (req: Request, res: Response) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authentication token required",
      });
    }

    const payload = verifyJwtToken(token);
    if (!payload) {
      return res.status(401).json({
        success: false,
        message: "Invalid authentication token",
      });
    }

    const { channels } = req.body;
    if (!Array.isArray(channels) || channels.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Channels array is required",
      });
    }

    // Get user preferences
    const result = await query(
      `SELECT 
        email,
        phone_number,
        email_notifications_enabled,
        sms_notifications_enabled,
        whatsapp_notifications_enabled
      FROM user_profiles
      WHERE public_key = $1`,
      [payload.publicKey],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User profile not found",
      });
    }

    const preferences = result.rows[0];
    const results: { channel: string; success: boolean; message?: string }[] = [];

    // Import services dynamically to avoid circular dependencies
    const { emailService } = await import("../services/emailService.js");
    const { smsService, whatsappService } = await import("../services/smsService.js");

    for (const channel of channels) {
      try {
        switch (channel) {
          case "email":
            if (preferences.email && preferences.email_notifications_enabled) {
              const success = await emailService.sendEmail({
                to: preferences.email,
                subject: "RemitLend: Test Notification",
                text: "This is a test notification from RemitLend to verify your email settings.",
                html: "<p>This is a test notification from RemitLend to verify your email settings.</p>",
              });
              results.push({ channel, success });
            } else {
              results.push({ 
                channel, 
                success: false, 
                message: "Email not configured or disabled" 
              });
            }
            break;

          case "sms":
            if (preferences.phone_number && preferences.sms_notifications_enabled) {
              const success = await smsService.sendSms({
                to: preferences.phone_number,
                body: "RemitLend: This is a test SMS notification to verify your settings.",
              });
              results.push({ channel, success });
            } else {
              results.push({ 
                channel, 
                success: false, 
                message: "Phone number not configured or SMS disabled" 
              });
            }
            break;

          case "whatsapp":
            if (preferences.phone_number && preferences.whatsapp_notifications_enabled) {
              const success = await whatsappService.sendWhatsApp({
                to: preferences.phone_number,
                body: "RemitLend: This is a test WhatsApp notification to verify your settings.",
              });
              results.push({ channel, success });
            } else {
              results.push({ 
                channel, 
                success: false, 
                message: "Phone number not configured or WhatsApp disabled" 
              });
            }
            break;

          default:
            results.push({ 
              channel, 
              success: false, 
              message: "Invalid channel" 
            });
        }
      } catch (error) {
        results.push({ 
          channel, 
          success: false, 
          message: error instanceof Error ? error.message : "Unknown error" 
        });
      }
    }

    res.json({
      success: true,
      data: results,
      message: "Test notifications completed",
    });
  } catch (error) {
    logger.error("Failed to send test notifications", { error });
    res.status(500).json({
      success: false,
      message: "Failed to send test notifications",
    });
  }
};
