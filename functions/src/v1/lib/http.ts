import type { Response } from "express";
import { ErrorResponseSchema } from "../schemas/common.schema";
import { getRequestId } from "./requestContext";
import { AppError } from "./errors";

export function sendJson(res: Response, status: number, body: unknown): void {
  res.status(status).json(body);
}

export function sendError(res: Response, err: AppError): void {
  const requestId = getRequestId(res.req as any);

  const payload = ErrorResponseSchema.parse({
    code: err.code,
    message: err.message,
    details: err.details,
    requestId,
  });

  sendJson(res, err.status, payload);
}
