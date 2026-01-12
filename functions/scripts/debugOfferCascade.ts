import admin from "firebase-admin";
import util from "node:util";

import { advanceOfferCascade } from "../src/v1/services/orchestration/auction.offerCascade.orchestrator";
import { ListingsRepo } from "../src/v1/repos/listings.repo";
import { AuctionsRepo } from "../src/v1/repos/auctions.repo";
import { AuctionStateRepo } from "../src/v1/repos/auctionState.repo";
import { BidsRepo } from "../src/v1/repos/bids.repo";

type OrchLogger = {
  info: (msg: string, fields?: any) => void;
  warn: (msg: string, fields?: any) => void;
  error: (msg: string, fields?: any) => void;
};

function envOr(name: string, fallback: string): string {
  return process.env[name] && process.env[name]!.length > 0 ? process.env[name]! : fallback;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) throw new Error(`Env ${name} must be an int`);
  return n;
}

async function main() {
  if (!admin.apps.length) admin.initializeApp();
  const db = admin.firestore();

  const listingId = envOr("LISTING_ID", "listing_seed_1");
  const auctionId = envOr("AUCTION_ID", "auction_seed_1");
  const nowMs = envInt("NOW_MS", Date.now());
  const excludeCsv = envOr("EXCLUDE_UIDS", "");
  const excludeBidderUids = excludeCsv.length ? excludeCsv.split(",").map((s) => s.trim()).filter(Boolean) : [];

  const logger: OrchLogger = {
    info: (m, f) => console.log("[orch][info]", m, f ?? ""),
    warn: (m, f) => console.warn("[orch][warn]", m, f ?? ""),
    error: (m, f) => console.error("[orch][error]", m, f ?? ""),
  };

  const deps = {
    listingsRepo: new ListingsRepo(db),
    auctionsMetaRepo: new AuctionsRepo(db),
    auctionStateRepo: new AuctionStateRepo(db),
    bidsRepo: new BidsRepo(db),
    logger: logger as any,
    requestId: "debug-advanceOfferCascade",
  };

  const res = await advanceOfferCascade(deps as any, {
    listingId,
    auctionId,
    nowMs,
    excludeBidderUids,
  });

  console.log("RESULT:");
  console.log(util.inspect(res, { depth: 20, colors: true }));
}

main().catch((e) => {
  console.error("FATAL:");
  console.error(e);
  process.exit(1);
});
