import type { ZodSchema } from "zod";

/**
 * Small helpers for consistent validation at the persistence boundary.
 * "Zod is the single source of truth" means: validate what we read + what we write.
 */

export function parseOrThrow<T>(schema: ZodSchema<T>, data: unknown, ctx: string): T {
  const res = schema.safeParse(data);
  if (!res.success) {
    const issues = res.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
      code: i.code,
    }));
    throw new Error(`RepoValidationError: ${ctx}: ${JSON.stringify(issues)}`);
  }
  return res.data;
}
