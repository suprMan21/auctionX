import type { Request } from "express";
import { getRequestId } from "../../lib/requestContext";
import { withLogContext } from "../../lib/logger";
import { db } from "../../lib/firebaseAdmin";

import type { PlaceBidDeps } from "./auction.orchestrator";
import { makeAuctionAggregateRepoPort } from "./auction.aggregate.adapter";

/**
 * Build orchestration dependencies from the HTTP request context.
 * API-layer wiring only (Module 04). No business logic.
 */
export function buildPlaceBidDeps(req: Request): PlaceBidDeps {
  const requestId = getRequestId(req);
  const logger = withLogContext({ requestId, route: req.path }) as any;

  return {
    auctionsRepo: makeAuctionAggregateRepoPort(db),
    logger,
    requestId,
  };
}
