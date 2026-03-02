import type { Registry } from "../../openapi/registry";
import { standardErrorResponses } from "../../openapi/schemas";

// We register paths here (same pattern as echo/health openapi files).
import { PlaceBidCommandSchema, PlaceBidResultSchema } from "../services/orchestration/auction.orchestrator.schemas";

export function registerAuctionsOpenApi(registry: Registry) {
  registry.registerPath({
    method: "post",
    path: "/auctions/{auctionId}/bids",
    tags: ["bids"],
    summary: "Place a bid (proxy bidding via mechanics)",
    request: {
      params: {
        required: true,
        content: {
          "application/json": {
            schema: { auctionId: { type: "string" } } as any,
          },
        },
      } as any,
      body: {
        required: true,
        content: {
          "application/json": { schema: PlaceBidCommandSchema },
        },
      },
    } as any,
    responses: {
      200: {
        description: "Bid placed; returns updated auction core",
        content: {
          "application/json": {
            schema: { data: PlaceBidResultSchema } as any,
          },
        },
      },
      ...standardErrorResponses(),
    },
  });
}
