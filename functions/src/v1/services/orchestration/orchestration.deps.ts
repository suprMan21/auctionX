import type { Request } from "express";
import { getRequestId } from "../../lib/requestContext";
import { withLogContext } from "../../lib/logger";

// NOTE: This builder is API-layer wiring only (Module 04).
// It constructs the orchestration deps without adding business logic.

import type { PlaceBidDeps, AuctionsRepoPort } from "./auction.orchestrator";

// We will wire the AuctionsRepoPort via an adapter.
// This adapter must already exist in orchestration (Module 03) — we are not re-implementing repo logic here.
import * as adapter from "./auction.aggregate.adapter";

export function buildPlaceBidDeps(req: Request): PlaceBidDeps {
  const requestId = getRequestId(req);

  // OrchestrationLogger shape: { info, warn, error, ... }
  const logger = withLogContext({ requestId, route: req.path }) as any;

  // Expect orchestration adapter to provide an AuctionsRepoPort factory or instance.
  // We avoid inventing a new DI framework; we only bridge to existing orchestration wiring.
  const auctionsRepo: AuctionsRepoPort =
    (adapter as any).auctionsRepoPort ??
    (adapter as any).buildAuctionsRepoPort?.() ??
    (adapter as any).makeAuctionsRepoPort?.() ??
    (adapter as any);

  return { auctionsRepo, logger, requestId };
}
