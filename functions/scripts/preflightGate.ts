import { execSync } from "node:child_process";

import admin from "firebase-admin";

import { advanceOfferCascade } from "../src/v1/services/orchestration/auction.offerCascade.orchestrator";
import { ListingsRepo } from "../src/v1/repos/listings.repo";
import { AuctionsRepo } from "../src/v1/repos/auctions.repo";
import { AuctionStateRepo } from "../src/v1/repos/auctionState.repo";
import { BidsRepo } from "../src/v1/repos/bids.repo";

function sh(cmd: string) {
  execSync(cmd, { stdio: "inherit", env: process.env });
}

function header(name: string) {
  const line = "=".repeat(60);
  console.log("");
  console.log(line);
  console.log(name);
  console.log(line);
  console.log("");
}

function setEnv(k: string, v: string) {
  process.env[k] = v;
}

function assertOk(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION_FAILED: `);
}

function assertExists<T>(v: T | null | undefined, msg: string): asserts v is T {
  if (v === null || v === undefined) throw new Error(`ASSERTION_FAILED: `);
}

let _firestoreSettingsApplied = false;

function getDb() {
  const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
  assertOk(projectId, "GCLOUD_PROJECT/GOOGLE_CLOUD_PROJECT must be set");

  if (!admin.apps.length) admin.initializeApp({ projectId });
  const db = admin.firestore();

  const host = process.env.FIRESTORE_EMULATOR_HOST;
  assertOk(host, "FIRESTORE_EMULATOR_HOST must be set");

  if (!_firestoreSettingsApplied) { if (!_firestoreSettingsApplied) { db.settings({ host, ssl: false }); _firestoreSettingsApplied = true; } _firestoreSettingsApplied = true; }
  return db;
}

async function readAuctionMeta(db: FirebaseFirestore.Firestore, listingId: string, auctionId: string) {
  const snap = await db.doc(`listings/${listingId}/auctions/${auctionId}`).get();
  return snap.exists ? snap.data() : null;
}

async function readAuctionState(db: FirebaseFirestore.Firestore, listingId: string, auctionId: string) {
  const snap = await db.doc(`listings/${listingId}/auctions/${auctionId}/state/current`).get();
  return snap.exists ? snap.data() : null;
}

async function countBids(db: FirebaseFirestore.Firestore, listingId: string, auctionId: string) {
  const bids = await db.collection(`listings/${listingId}/auctions/${auctionId}/bids`).get();
  return bids.size;
}

async function expectClosedState(args: {
  listingId: string;
  auctionId: string;
  expectedWinnerUid: string | null;
  expectedWinningPriceCents: number;
  expectedReason: string;
  expectedAuctionPriceCents: number;
}) {
  const db = getDb();

  const meta = await readAuctionMeta(db, args.listingId, args.auctionId);
  assertExists(meta, `auction meta missing: ${args.listingId}/${args.auctionId}`);
  assertOk(meta.status === "CLOSED", `auction.status expected CLOSED, got ${meta.status}`);
  assertOk(
    meta.pricing?.currentPriceCents === args.expectedAuctionPriceCents,
    `auction.pricing.currentPriceCents expected ${args.expectedAuctionPriceCents}, got ${meta.pricing?.currentPriceCents}`
  );

  const state = await readAuctionState(db, args.listingId, args.auctionId);
  assertExists(state, `auction state missing: ${args.listingId}/${args.auctionId}`);
  assertOk(state.close?.reason === args.expectedReason, `close.reason expected ${args.expectedReason}, got ${state.close?.reason}`);
  assertOk(state.close?.winnerUid === args.expectedWinnerUid, `close.winnerUid expected ${args.expectedWinnerUid}, got ${state.close?.winnerUid}`);
  assertOk(
    state.close?.winningPriceCents === args.expectedWinningPriceCents,
    `close.winningPriceCents expected ${args.expectedWinningPriceCents}, got ${state.close?.winningPriceCents}`
  );
}

async function expectCascade(args: {
  listingId: string;
  auctionId: string;
  expectedKind: "PAYMENT_REQUIRED" | "NO_ELIGIBLE_BIDDERS";
  expectedBuyerUid?: string | null;
  expectedAmountCents?: number | null;
  expectedOfferPriceCents?: number | null;
}) {
  const db = getDb();

  const deps = {
    listingsRepo: new ListingsRepo(db as any),
    auctionsMetaRepo: new AuctionsRepo(db as any),
    auctionStateRepo: new AuctionStateRepo(db as any),
    bidsRepo: new BidsRepo(db as any),
    logger: { info() {}, warn() {}, error() {} } as any,
    requestId: "preflight-gate",
  };

  const res = await advanceOfferCascade(deps as any, {
    listingId: args.listingId,
    auctionId: args.auctionId,
    nowMs: Date.now(),
    excludeBidderUids: [],
  });

  assertOk(res.ok, `advanceOfferCascade failed: ${(res as any).error?.code ?? "UNKNOWN"} ${(res as any).error?.message ?? ""}`);

  const v: any = (res as any).value;
  assertOk(v?.outcome?.kind === args.expectedKind, `cascade outcome.kind expected ${args.expectedKind}, got ${v?.outcome?.kind}`);

  if (args.expectedKind === "PAYMENT_REQUIRED") {
    assertOk(v.outcome.buyerUid === args.expectedBuyerUid, `cascade buyerUid expected ${args.expectedBuyerUid}, got ${v.outcome.buyerUid}`);
    assertOk(v.outcome.amountCents === args.expectedAmountCents, `cascade amountCents expected ${args.expectedAmountCents}, got ${v.outcome.amountCents}`);
    assertOk(v.computed.offerPriceCents === args.expectedOfferPriceCents, `cascade offerPriceCents expected ${args.expectedOfferPriceCents}, got ${v.computed.offerPriceCents}`);
  } else {
    assertOk(v.computed.nextWinnerUid === null, `cascade nextWinnerUid expected null, got ${v.computed.nextWinnerUid}`);
  }
}

async function main() {
  header("BUILD");
  sh("npm run build");

  header("SCENARIO 1: 2 bidders -> close -> cascade");
  setEnv("LISTING_ID", "listing_seed_1");
  setEnv("AUCTION_ID", "auction_seed_gate_2bidders_1");
  sh("npx ts-node ./scripts/wipeAuction.ts");
  sh("npx ts-node ./scripts/seedListing.ts");
  sh("npx ts-node ./scripts/seedAuction.ts");

  setEnv("BIDDER_UID", "user_1");
  setEnv("AMOUNT_CENTS", "12000");
  sh("npx ts-node ./scripts/debugPlaceBid.ts");

  setEnv("BIDDER_UID", "user_2");
  setEnv("AMOUNT_CENTS", "15000");
  sh("npx ts-node ./scripts/debugPlaceBid.ts");

  {
    const db = getDb();
    const bidsCount = await countBids(db, process.env.LISTING_ID!, process.env.AUCTION_ID!);
    assertOk(bidsCount === 2, `scenario1 bidsCount expected 2, got ${bidsCount}`);
  }

  sh("npx ts-node ./scripts/debugEndAuctionNow.ts");
  sh("npx ts-node ./scripts/debugCloseAuction.ts");

  await expectClosedState({
    listingId: process.env.LISTING_ID!,
    auctionId: process.env.AUCTION_ID!,
    expectedWinnerUid: "user_2",
    expectedWinningPriceCents: 12500,
    expectedReason: "TIME_ELAPSED",
    expectedAuctionPriceCents: 12500,
  });

  await expectCascade({
    listingId: process.env.LISTING_ID!,
    auctionId: process.env.AUCTION_ID!,
    expectedKind: "PAYMENT_REQUIRED",
    expectedBuyerUid: "user_1",
    expectedAmountCents: 1000,
    expectedOfferPriceCents: 1000,
  });

  header("SCENARIO 2: 3 bidders -> close -> cascade");
  setEnv("LISTING_ID", "listing_seed_1");
  setEnv("AUCTION_ID", "auction_seed_gate_3bidders_1");
  sh("npx ts-node ./scripts/wipeAuction.ts");
  sh("npx ts-node ./scripts/seedListing.ts");
  sh("npx ts-node ./scripts/seedAuction.ts");

  setEnv("BIDDER_UID", "user_1");
  setEnv("AMOUNT_CENTS", "12000");
  sh("npx ts-node ./scripts/debugPlaceBid.ts");

  setEnv("BIDDER_UID", "user_2");
  setEnv("AMOUNT_CENTS", "15000");
  sh("npx ts-node ./scripts/debugPlaceBid.ts");

  setEnv("BIDDER_UID", "user_3");
  setEnv("AMOUNT_CENTS", "13000");
  sh("npx ts-node ./scripts/debugPlaceBid.ts");

  {
    const db = getDb();
    const bidsCount = await countBids(db, process.env.LISTING_ID!, process.env.AUCTION_ID!);
    assertOk(bidsCount === 3, `scenario2 bidsCount expected 3, got ${bidsCount}`);
  }

  sh("npx ts-node ./scripts/debugEndAuctionNow.ts");
  sh("npx ts-node ./scripts/debugCloseAuction.ts");

  await expectClosedState({
    listingId: process.env.LISTING_ID!,
    auctionId: process.env.AUCTION_ID!,
    expectedWinnerUid: "user_2",
    expectedWinningPriceCents: 13500,
    expectedReason: "TIME_ELAPSED",
    expectedAuctionPriceCents: 13500,
  });

  await expectCascade({
    listingId: process.env.LISTING_ID!,
    auctionId: process.env.AUCTION_ID!,
    expectedKind: "PAYMENT_REQUIRED",
    expectedBuyerUid: "user_3",
    expectedAmountCents: 12500,
    expectedOfferPriceCents: 12500,
  });

  header("SCENARIO 3: no bids -> close -> cascade");
  setEnv("LISTING_ID", "listing_seed_1");
  setEnv("AUCTION_ID", "auction_seed_gate_nobids_1");
  sh("npx ts-node ./scripts/wipeAuction.ts");
  sh("npx ts-node ./scripts/seedListing.ts");
  sh("npx ts-node ./scripts/seedAuctionEnded.ts");

  sh("npx ts-node ./scripts/debugCloseAuction.ts");

  await expectClosedState({
    listingId: process.env.LISTING_ID!,
    auctionId: process.env.AUCTION_ID!,
    expectedWinnerUid: null,
    expectedWinningPriceCents: 1000,
    expectedReason: "NO_BIDS",
    expectedAuctionPriceCents: 1000,
  });

  await expectCascade({
    listingId: process.env.LISTING_ID!,
    auctionId: process.env.AUCTION_ID!,
    expectedKind: "NO_ELIGIBLE_BIDDERS",
  });

  header("PREFLIGHT GATE: PASS");
  console.log(JSON.stringify({ ok: true }, null, 2));
}

main().catch((e) => {
  console.error("PREFLIGHT GATE: FAIL");
  console.error(e);
  process.exit(1);
});
