import { z } from "zod";
import { BaseMetaSchema, DocIdSchema } from "./common.schema";

/**
 * Categories support hierarchy via parentId + path.
 * "isAdult" is the locked 18+ signal (category-based).
 */
export const CategorySchema = BaseMetaSchema.extend({
  name: z.string().min(1).max(120),

  parentId: DocIdSchema.optional(),

  /**
   * Hierarchy path of category IDs from root -> this node, inclusive.
   * Example: ["collectibles", "cards", "pokemon"]
   */
  path: z.array(DocIdSchema).default([]),

  isAdult: z.boolean().default(false),
  isActive: z.boolean().default(true),

  sortOrder: z.number().int().optional(),
});

export type Category = z.infer<typeof CategorySchema>;
