import { z } from "zod";

/**
 * Validate at the persistence boundary (read + write).
 *
 * IMPORTANT:
 * Use z.output<S> so TypeScript sees the POST-PARSE shape:
 * - defaults applied (.default)
 * - transforms applied (.transform)
 * - preprocess applied (z.preprocess)
 *
 * If we used a plain generic T, TS can accidentally model the input type,
 * which makes defaulted fields appear optional (causing TS2322 errors).
 */
export function parseOrThrow<S extends z.ZodTypeAny>(
  schema: S,
  data: unknown,
  ctx: string
): z.output<S> {
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
