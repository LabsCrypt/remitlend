import { z } from "zod";

const nullableTrimmedString = (max: number) =>
  z.string().trim().max(max).nullable().optional();

export const updateUserProfileSchema = z
  .object({
    displayName: nullableTrimmedString(255),
    email: z.string().trim().email().max(255).nullable().optional(),
    phone: nullableTrimmedString(50),
    locale: z
      .string()
      .trim()
      .regex(/^[a-z]{2}(-[A-Z]{2})?$/, "Locale must look like en or en-US")
      .nullable()
      .optional(),
    avatarUrl: z.string().trim().url().max(2048).nullable().optional(),
  })
  .strict();

export type UpdateUserProfileInput = z.infer<typeof updateUserProfileSchema>;
