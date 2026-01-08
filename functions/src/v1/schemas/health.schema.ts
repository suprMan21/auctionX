import { z } from "zod";

export const HealthResponseSchema = z.object({
  ok: z.literal(true),
  service: z.literal("auction-api"),
  version: z.string(),
  time: z.string(), // ISO
  requestId: z.string(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
