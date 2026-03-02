import { z } from "zod";
import { Timestamp } from "firebase-admin/firestore";

/**
 * Firestore Timestamp at rest.
 * If you later support ISO strings at the API boundary, do that at the request/response schemas layer.
 */
export const FirestoreTimestampSchema = z.instanceof(Timestamp);

/**
 * Common ID constraints (Firestore document IDs).
 * Keep permissive; Firestore allows many chars but some clients may not.
 */
export const DocIdSchema = z.string().min(1);

/**
 * Standard metadata used across persisted documents.
 */
export const BaseMetaSchema = z.object({
  id: DocIdSchema,
  createdAt: FirestoreTimestampSchema,
  updatedAt: FirestoreTimestampSchema,
});

export type BaseMeta = z.infer<typeof BaseMetaSchema>;

/**
 * Optional "createdBy" style metadata. Use when a doc has a natural actor.
 */
export const CreatedBySchema = z.object({
  createdByUid: z.string().min(1),
});
