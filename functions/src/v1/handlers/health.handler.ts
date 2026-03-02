import type { Request, Response } from "express";
import { getRequestId } from "../lib/requestContext";
import { sendJson } from "../lib/http";
import { HealthResponseSchema } from "../schemas/health.schema";
import { healthService } from "../services/health.service";

export async function healthHandler(
  req: Request,
  res: Response
): Promise<void> {
  // service-layer call (no business logic here)
  const requestId = getRequestId(req);

  const result = await healthService({ requestId });

  // schema-first: validate outbound response (prevents contract drift)
  const body = HealthResponseSchema.parse(result);

  sendJson(res, 200, body);
}
