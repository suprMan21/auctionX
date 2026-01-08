import { z } from "zod";

/**
 * Locked error model.
 * { code, message, details?, requestId }
 */
export const ErrorResponseSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
  requestId: z.string(),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
