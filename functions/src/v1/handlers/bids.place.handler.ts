import type { Request, Response } from "express";
import { z } from "zod";
import { sendError, sendJson } from "../lib/http";
import { AppError } from "../lib/errors";

import { PlaceBidCommandSchema } from "../services/orchestration/auction.orchestrator.schemas";
import { placeBid } from "../services/orchestration/auction.orchestrator";
import { buildPlaceBidDeps } from "../services/orchestration/orchestration.deps";

function mapOrchErrorToAppError(e: any): AppError {
  const code = typeof e?.code === "string" ? e.code : "INTERNAL";
  const message = typeof e?.message === "string" ? e.message : "Request failed";
  const details = e?.details ?? e;

  const status =
    code === "VALIDATION_FAILED" ? 400 :
    code === "NOT_FOUND" ? 404 :
    code === "VERSION_CONFLICT" ? 409 :
    code === "PRECONDITION_FAILED" ? 409 :
    code === "UNAUTHORIZED" ? 401 :
    code === "FORBIDDEN" ? 403 :
    code === "RATE_LIMITED" ? 429 :
    500;

  return { status, code, message, details } as any as AppError;
}

function toInternalError(e: unknown): AppError {
  const message =
    e instanceof Error ? e.message :
    typeof e === "string" ? e :
    "Unexpected error";

  return {
    status: 500,
    code: "INTERNAL",
    message: "Internal server error",
    details: { message },
  } as any as AppError;
}

export async function placeBidHandler(req: Request, res: Response) {
  const auctionId = String((req as any).params?.auctionId ?? "");

  let input: z.infer<typeof PlaceBidCommandSchema>;
  try {
    input = PlaceBidCommandSchema.parse({
      ...(req.body ?? {}),
      auctionId,
    });
  } catch (e) {
    sendError(
      res,
      {
        status: 400,
        code: "BAD_REQUEST",
        message: "Invalid request body",
        details: e,
      } as any as AppError
    );
    return;
  }

  try {
    const deps = buildPlaceBidDeps(req);

    const result = await placeBid(deps, input);

    if (!result.ok) {
      sendError(res, mapOrchErrorToAppError(result.error));
      return;
    }

    sendJson(res, 200, { data: result.value });
  } catch (e) {
    sendError(res, toInternalError(e));
  }
}
