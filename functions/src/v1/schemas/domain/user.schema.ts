import { z } from "zod";
import { FirestoreTimestampSchema } from "./common.schema";

/**
 * Base user shape (persistence).
 * No auth enforcement or claims mapping here.
 */
export const UserRolesSchema = z.object({
  admin: z.boolean().optional(),
  moderator: z.boolean().optional(),
});

export const UserSchema = z.object({
  uid: z.string().min(1),

  displayName: z.string().min(1).max(120).optional(),
  photoURL: z.string().url().optional(),

  email: z.string().email().optional(),
  phoneNumber: z.string().min(4).max(32).optional(),

  roles: UserRolesSchema.optional(),

  createdAt: FirestoreTimestampSchema,
  updatedAt: FirestoreTimestampSchema,
});

export type User = z.infer<typeof UserSchema>;
