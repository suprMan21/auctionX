import admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";

import { AuctionSchema, type Auction } from "../src/v1/schemas/domain/auction.schema";
import { AuctionStateSchema, type AuctionState } from "../src/v1/schemas/domain/auctionState.schema";
import { parseOrThrow } from "../src/v1/repos/repo.utils";
import { auctionPath, auctionStatePath } from "../src/v1/repos/paths";

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
  const auctionId = envOr("AUCTION_ID", "auction_seed_ended_1");

  const nowMs = envInt("NOW_MS", Date.now());
  const endAtMs = nowMs - envInt("ENDED_AGO_MS", 60_000);
  const startAtMs = endAtMs - envInt("DURATION_MS", 60 * 60_000);

  const startAt = Timestamp.fromMillis(startAtMs);
  const endAt = Timestamp.fromMillis(endAtMs);

  const auction: Auction = parseOrThrow(
    AuctionSchema,
    {
      id: auctionId,
      listingId,
      iteration: 0,
      status: "RUNNING",
      schedule: { startAt, endAt },
      snapshot: {
        title: envOr("SNAPSHOT_TITLE", "Seed Ended Auction Listing"),
        categoryId: envOr("SNAPSHOT_CATEGORY_ID", "category_seed_1"),
        sellerUid: envOr("SNAPSHOT_SELLER_UID", "seller_seed_1"),
      },
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    },
    `Seed:Auction:${listingId}/${auctionId}`
  );

  const startPriceCents = envInt("START_PRICE_CENTS", 1000);

  const state: AuctionState = parseOrThrow(
    AuctionStateSchema,
    {
      listingId,
      auctionId,
      version: 0,
      updatedAtMs: nowMs,
      pricing: {
        startPriceCents,
        currentPriceCents: startPriceCents,
      },
      proxy: {
        highBidderUid: null,
        highBidderMaxCents: null,
        secondHighestMaxCents: null,
      },
    },
    `Seed:AuctionState:${listingId}/${auctionId}`
  );

  await db.doc(auctionPath(listingId, auctionId)).set(auction, { merge: false });
  await db.doc(auctionStatePath(listingId, auctionId)).set(state, { merge: false });

  console.log(
    JSON.stringify(
      {
        ok: true,
        listingId,
        auctionId,
        nowMs,
        startAtMs,
        endAtMs,
        paths: {
          auction: auctionPath(listingId, auctionId),
          state: auctionStatePath(listingId, auctionId),
        },
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
