import { z } from "zod";
import { BrandSchema } from "./enums.schema";

/**
 * Category schema with brand association
 */
export const CategorySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  
  // NEW: Brand association
  brand: BrandSchema,
  
  // DEPRECATED: Use brand === "UNMENTIONABLES" instead
  isAdult: z.boolean().optional(),
  
  isActive: z.boolean().default(true),
  
  // Hierarchical support
  parentId: z.string().optional(),
  path: z.string().min(1), // materialized path
  
  // Display order
  sortOrder: z.number().int().nonnegative().default(0),
});

export type Category = z.infer<typeof CategorySchema>;
