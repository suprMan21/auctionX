import { z } from "zod";
import { AuctionIdParamSchema } from "./auctions.schema";

import {
  PlaceBidCommandSchema,
  PlaceBidResultSchema,
} from "../services/orchestration/auction.orchestrator.schemas";

export const PlaceBidParamsSchema = AuctionIdParamSchema;

// For HTTP, we accept the same shape as orchestration command,
// but auctionId comes from params. We keep this schema for OpenAPI reference.
export const PlaceBidBodySchema = PlaceBidCommandSchema.omit({ auctionId: true });

export const PlaceBidResultBodySchema = PlaceBidResultSchema;

export const PlaceBidResponseSchema = z.object({
  data: PlaceBidResultBodySchema,
});
