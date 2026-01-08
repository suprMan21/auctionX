import { z } from "zod";

export const EchoRequestSchema = z.object({
  message: z.string().min(1).max(500),
});

export type EchoRequest = z.infer<typeof EchoRequestSchema>;

export const EchoResponseSchema = z.object({
  message: z.string(),
  requestId: z.string(),
});

export type EchoResponse = z.infer<typeof EchoResponseSchema>;
