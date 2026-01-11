import type { Request, Response } from "express";

import { withRequestContext } from "./lib/requestContext";
import { sendError } from "./lib/http";
import { AppError } from "./lib/errors";

// Existing routes
import { echoRoute } from "./routes/echo.routes";
import { healthRoute } from "./routes/health.routes";

// Module 04 routes
import { placeBidRoute } from "./routes/auctions.routes";

// NOTE: OpenAPI sidecars are used by the generator tooling, not at runtime.
// Keep them as explicit modules.
import "./schemas/echo.openapi";
import "./schemas/health.openapi";
import "./schemas/auctions.openapi";
import "./schemas/bids.openapi";

type Route = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: RegExp;
  handler: (req: Request, res: Response) => Promise<void>;
};

const routes: Route[] = [
  healthRoute,
  echoRoute,

  // Module 04
  placeBidRoute,
];

function notFoundError(req: Request): AppError {
  return {
    status: 404,
    code: "NOT_FOUND",
    message: `No route for ${req.method} ${req.path}`,
  } as any as AppError;
}

function unexpectedError(e: unknown): AppError {
  return {
    status: 500,
    code: "INTERNAL",
    message: "Unexpected error",
    details: { cause: e },
  } as any as AppError;
}

/**
 * v1Router is the canonical API entrypoint.
 * Called by functions/src/index.ts (firebase onRequest wrapper).
 */
export async function v1Router(req: Request, res: Response): Promise<void> {
  await withRequestContext(req, res, async () => {
    try {
      const m = (req.method || "GET").toUpperCase();
      const match = routes.find((r) => r.method === m && r.path.test(req.path));

      if (!match) {
        sendError(res, notFoundError(req));
        return;
      }

      await match.handler(req, res);
    } catch (e) {
      sendError(res, unexpectedError(e));
    }
  });
}
