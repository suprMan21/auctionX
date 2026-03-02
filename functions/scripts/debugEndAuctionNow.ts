import admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";

import { AuctionsRepo } from "../src/v1/repos/auctions.repo";

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

  const repo = new AuctionsRepo(db);
  const existing = await repo.get(listingId, auctionId);
  if (!existing) throw new Error(`NotFound: Auction:${listingId}/${auctionId}`);

  const nextEndAt = Timestamp.fromMillis(nowMs - 1);

  const updated = await repo.update(listingId, auctionId, {
    schedule: {
      startAt: existing.schedule.startAt,
      endAt: nextEndAt,
    },
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        listingId,
        auctionId,
        endAtMs: updated.schedule.endAt.toMillis(),
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
