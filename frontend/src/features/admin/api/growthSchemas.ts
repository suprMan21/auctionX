/**
 * Admin console UX-3 — dashboard growth (GET /admin/stats/growth). Counts only:
 * the server returns no emails, account ids or chip identifiers.
 */

import { z } from 'zod';

export const growthSchema = z.object({
  series: z.enum(['tokens', 'accounts']),
  bucket: z.enum(['day', 'month']),
  tz: z.string(),
  from: z.string(),
  to: z.string(),
  addedToday: z.number().int(),
  active: z.number().int(),
  totalBefore: z.number().int(),
  points: z.array(z.object({ start: z.string(), count: z.number().int() })),
});
export type GrowthSeries = z.infer<typeof growthSchema>;
export type GrowthKind = GrowthSeries['series'];
export type GrowthBucket = GrowthSeries['bucket'];
