import type { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

const REQUEST_ID_HEADER = "x-request-id";

// Attach requestId to req (typed as any to avoid ambient type augmentation)
function setRequestId(req: Request, requestId: string) {
  (req as any).__requestId = requestId;
}

export function getRequestId(req: Request): string {
  return (req as any).__requestId || "unknown";
}

/**
 * Ensures every request has a requestId.
 * - If client provides x-request-id, we use it.
 * - Otherwise we generate one.
 * Also echoes it back in response headers.
 */
export async function withRequestContext(
  req: Request,
  res: Response,
  fn: () => Promise<void>
): Promise<void> {
  const incoming = req.header(REQUEST_ID_HEADER);
  const requestId = incoming && incoming.length > 0 ? incoming : uuidv4();

  setRequestId(req, requestId);
  res.setHeader(REQUEST_ID_HEADER, requestId);

  await fn();
}
