import type { Request, Response } from "express";
import { healthHandler } from "../handlers/health.handler";

export const healthRoute = {
  method: "GET" as const,
  // Matches /v1/health exactly (req.path includes /v1/health due to hosting rewrite)
  path: /^\/v1\/health$/,
  handler: async (req: Request, res: Response) => healthHandler(req, res),
};
