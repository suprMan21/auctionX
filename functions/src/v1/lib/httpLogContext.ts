import type { Request } from "express";
import { getRequestId } from "./requestContext";
import { withLogContext } from "./logger";

/**
 * Builds a request-correlated logger for express handlers.
 * Route is best-effort (baseUrl + path); adjust if you have a canonical route name.
 */
export function getReqLogger(req: Request) {
  const route = `${req.baseUrl || ""}${req.path || ""}` || null;
  return withLogContext({ requestId: getRequestId(req), route });
}
