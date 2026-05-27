import type { Request, Response } from "express";
import { query } from "../db/connection.js";
import { AppError } from "../errors/AppError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import type { UpdateUserProfileInput } from "../schemas/userSchemas.js";

interface UserProfileRow {
  id: number;
  public_key: string;
  display_name: string | null;
  email: string | null;
  phone: string | null;
  email_enabled?: boolean | null;
  sms_enabled?: boolean | null;
  created_at: Date | string;
  updated_at: Date | string;
  metadata: Record<string, unknown> | null;
}

function metadataFrom(row: UserProfileRow): Record<string, unknown> {
  return row.metadata && typeof row.metadata === "object" ? row.metadata : {};
}

function toIsoString(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function serializeProfile(row: UserProfileRow) {
  const metadata = metadataFrom(row);

  return {
    id: String(row.id),
    email: row.email ?? "",
    walletAddress: row.public_key,
    kycVerified: Boolean(
      metadata.kycVerified ?? metadata.kyc_verified ?? false,
    ),
    displayName: row.display_name ?? "",
    phone: row.phone ?? "",
    locale: typeof metadata.locale === "string" ? metadata.locale : undefined,
    avatarUrl:
      typeof metadata.avatarUrl === "string"
        ? metadata.avatarUrl
        : typeof metadata.avatar_url === "string"
          ? metadata.avatar_url
          : undefined,
    emailEnabled: Boolean(row.email_enabled),
    smsEnabled: Boolean(row.sms_enabled),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

async function getOrCreateProfile(publicKey: string): Promise<UserProfileRow> {
  const result = await query(
    `WITH inserted AS (
       INSERT INTO user_profiles (public_key, metadata)
       VALUES ($1, '{}'::jsonb)
       ON CONFLICT (public_key) DO NOTHING
       RETURNING *
     )
     SELECT * FROM inserted
     UNION ALL
     SELECT * FROM user_profiles WHERE public_key = $1
     LIMIT 1`,
    [publicKey],
  );

  const profile = result.rows[0] as UserProfileRow | undefined;
  if (!profile) {
    throw AppError.internal("Unable to load user profile");
  }

  return profile;
}

export const getUserProfile = asyncHandler(
  async (req: Request, res: Response) => {
    const publicKey = req.user?.publicKey;
    if (!publicKey) {
      throw AppError.unauthorized("Authentication required");
    }

    const profile = await getOrCreateProfile(publicKey);
    res.json(serializeProfile(profile));
  },
);

export const updateUserProfile = asyncHandler(
  async (req: Request, res: Response) => {
    const publicKey = req.user?.publicKey;
    if (!publicKey) {
      throw AppError.unauthorized("Authentication required");
    }

    const input = req.body as UpdateUserProfileInput;
    const current = await getOrCreateProfile(publicKey);
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (input.displayName !== undefined) {
      updates.push(`display_name = $${paramIndex++}`);
      values.push(input.displayName);
    }

    if (input.email !== undefined) {
      updates.push(`email = $${paramIndex++}`);
      values.push(input.email);
    }

    if (input.phone !== undefined) {
      updates.push(`phone = $${paramIndex++}`);
      values.push(input.phone);
    }

    if (input.locale !== undefined || input.avatarUrl !== undefined) {
      const metadata = { ...metadataFrom(current) };

      if (input.locale === null) {
        delete metadata.locale;
      } else if (input.locale !== undefined) {
        metadata.locale = input.locale;
      }

      if (input.avatarUrl === null) {
        delete metadata.avatarUrl;
        delete metadata.avatar_url;
      } else if (input.avatarUrl !== undefined) {
        metadata.avatarUrl = input.avatarUrl;
        delete metadata.avatar_url;
      }

      updates.push(`metadata = $${paramIndex++}::jsonb`);
      values.push(JSON.stringify(metadata));
    }

    if (updates.length === 0) {
      res.json(serializeProfile(current));
      return;
    }

    updates.push("updated_at = CURRENT_TIMESTAMP");
    values.push(publicKey);

    const result = await query(
      `UPDATE user_profiles
     SET ${updates.join(", ")}
     WHERE public_key = $${paramIndex}
     RETURNING *`,
      values,
    );

    const updated = result.rows[0] as UserProfileRow | undefined;
    if (!updated) {
      throw AppError.notFound("User profile not found");
    }

    res.json(serializeProfile(updated));
  },
);
