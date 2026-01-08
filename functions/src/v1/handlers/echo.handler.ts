import type { Request, Response } from "express";
import { AppError } from "../lib/errors";
import { sendJson } from "../lib/http";
import { getRequestId } from "../lib/requestContext";
import { EchoRequestSchema, EchoResponseSchema } from "../schemas/echo.schema";
import { echoService } from "../services/echo.service";

export async function echoHandler(req: Request, res: Response): Promise<void> {
  const requestId = getRequestId(req);

  // Parse JSON body safely (express may not have json middleware in CF v2)
  let rawBody: unknown = req.body;
  if (rawBody == null || (typeof rawBody === "string" && rawBody.length === 0)) {
    // Try parsing if raw body is a string
    if (typeof req.body === "string") {
      try {
        rawBody = JSON.parse(req.body);
      } catch {
        throw new AppError("invalid_argument", "Invalid JSON body");
      }
    }
  }

  const parsed = EchoRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    // Locked error model + intentional code/status
    throw new AppError("invalid_argument", "Validation failed", parsed.error.issues);
  }

  const result = await echoService({
    requestId,
    message: parsed.data.message,
  });

  const body = EchoResponseSchema.parse(result);
  sendJson(res, 200, body);
}
