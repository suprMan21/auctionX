import type { Firestore } from "firebase-admin/firestore";

import { AuctionsRepo } from "../../repos/auctions.repo";
import { AuctionStateRepo } from "../../repos/auctionState.repo";
import { AuctionCoreSchema, type AuctionCore } from "../auctions/auction.types";
import type { Preconditions, AuctionPatch } from "../auctions/auction.types";
import type { RepoApplyPatchResult, RepoReadResult } from "./orchestration.types";

export type AuctionAggregateRepoPort = {
  getCore: (listingId: string, auctionId: string) => Promise<RepoReadResult<AuctionCore> | null>;
  applyMechanicsPatch: (args: {
    listingId: string;
    auctionId: string;
    expectedVersion: number;
    preconditions: Preconditions;
    patch: AuctionPatch;
    nowMs: number;
  }) => Promise<RepoApplyPatchResult<AuctionCore>>;
};

export function makeAuctionAggregateRepoPort(db: Firestore): AuctionAggregateRepoPort {
  const auctions = new AuctionsRepo(db);
  const state = new AuctionStateRepo(db);

  return {
    async getCore(listingId, auctionId) {
      const [a, s] = await Promise.all([auctions.get(listingId, auctionId), state.getState(listingId, auctionId)]);
      if (!a || !s) return null;

      const core: AuctionCore = {
        id: a.id,
        listingId: a.listingId,
        status: a.status,
        schedule: { startAtMs: a.schedule.startAt.toMillis(), endAtMs: a.schedule.endAt.toMillis() },
        pricing: { startPriceCents: s.pricing.startPriceCents, currentPriceCents: s.pricing.currentPriceCents },
        version: s.version,
        updatedAtMs: s.updatedAtMs,
        proxy: {
          highBidderUid: s.proxy.highBidderUid,
          highBidderMaxCents: s.proxy.highBidderMaxCents,
          secondHighestMaxCents: s.proxy.secondHighestMaxCents,
        },
      };

      return { value: AuctionCoreSchema.parse(core), version: s.version };
    },

    async applyMechanicsPatch(args) {
      const out = await state.applyMechanicsPatch({
        listingId: args.listingId,
        auctionId: args.auctionId,
        preconditions: args.preconditions,
        patch: args.patch,
        nowMs: args.nowMs,
      });

      // rebuild core from updated docs
      const core: AuctionCore = {
        id: out.auction.id,
        listingId: out.auction.listingId,
        status: out.auction.status,
        schedule: { startAtMs: out.auction.schedule.startAt.toMillis(), endAtMs: out.auction.schedule.endAt.toMillis() },
        pricing: { startPriceCents: out.state.pricing.startPriceCents, currentPriceCents: out.state.pricing.currentPriceCents },
        version: out.state.version,
        updatedAtMs: out.state.updatedAtMs,
        proxy: {
          highBidderUid: out.state.proxy.highBidderUid,
          highBidderMaxCents: out.state.proxy.highBidderMaxCents,
          secondHighestMaxCents: out.state.proxy.secondHighestMaxCents,
        },
      };

      const parsed = AuctionCoreSchema.parse(core);
      return { value: parsed, version: parsed.version };
    },
  };
}
