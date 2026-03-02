import type { Request, Response } from "express";
import { placeBidHandler } from "../handlers/bids.place.handler";

const placeBidPath = /^\/v1\/auctions\/([^/]+)\/bids$/;

export const placeBidRoute = {
  method: "POST" as const,
  path: placeBidPath,
  handler: async (req: Request, res: Response) => {
    const m = placeBidPath.exec(req.path);
    const auctionId = m?.[1] ?? "";

    // Attach params for handler compatibility
    (req as any).params = { ...(req as any).params, auctionId };

    return placeBidHandler(req, res);
  },
};
