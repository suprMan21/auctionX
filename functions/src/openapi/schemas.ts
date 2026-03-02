import { z } from "zod";
import type { Registry } from "./registry";

/**
 * Standard API error model.
 * Must match runtime error response shape exactly:
 * { code, message, details?, requestId }
 */
export const ApiErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  details: z.unknown().optional(),
  requestId: z.string().min(1),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;

/**
 * Register shared schemas so routes can reference them cleanly.
 */
export function registerSharedSchemas(registry: Registry) {
  // This name becomes a reusable component in the OpenAPI doc.
  registry.register("ApiError", ApiErrorSchema);
}

/**
 * Helper: standard error responses used across endpoints in the spec.
 * Keeps route registration explicit and consistent, without hiding anything.
 */
export function standardErrorResponses() {
  const errorJson = {
    "application/json": {
      schema: ApiErrorSchema,
    },
  };

  return {
    400: { description: "Bad Request", content: errorJson },
    401: { description: "Unauthorized", content: errorJson },
    403: { description: "Forbidden", content: errorJson },
    404: { description: "Not Found", content: errorJson },
    409: { description: "Conflict", content: errorJson },
    429: { description: "Too Many Requests", content: errorJson },
    500: { description: "Internal Server Error", content: errorJson },
  } as const;
}