import { execSync } from "node:child_process";

function sh(cmd: string) {
  execSync(cmd, { stdio: "inherit", env: process.env });
}

function setEnv(k: string, v: string) {
  process.env[k] = v;
}

function header(title: string) {
  console.log("\n============================================================");
  console.log(title);
  console.log("============================================================\n");
}

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v || v.length === 0) throw new Error(`Missing env ${name}`);
}

async function main() {
  requireEnv("GCLOUD_PROJECT");
  requireEnv("GOOGLE_CLOUD_PROJECT");
  requireEnv("FIRESTORE_EMULATOR_HOST");

  header("BUILD");
  sh("npm run build");

  header("SCENARIO 1: 2 bidders -> close -> cascade");
  setEnv("LISTING_ID", "listing_seed_1");
  setEnv("AUCTION_ID", "auction_seed_gate_2bidders_1");
  sh("npx ts-node ./scripts/seedListing.ts");
  sh("npx ts-node ./scripts/seedAuction.ts");

  setEnv("BIDDER_UID", "user_1");
  setEnv("AMOUNT_CENTS", "12000");
  sh("npx ts-node ./scripts/debugPlaceBid.ts");

  setEnv("BIDDER_UID", "user_2");
  setEnv("AMOUNT_CENTS", "15000");
  sh("npx ts-node ./scripts/debugPlaceBid.ts");

  sh("npx ts-node ./scripts/dumpBids.ts");
  sh("npx ts-node ./scripts/debugEndAuctionNow.ts");
  sh("npx ts-node ./scripts/debugCloseAuction.ts");
  sh("npx ts-node ./scripts/debugOfferCascade.ts");

  header("SCENARIO 2: 3 bidders -> close -> cascade");
  setEnv("LISTING_ID", "listing_seed_1");
  setEnv("AUCTION_ID", "auction_seed_gate_3bidders_1");
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

  sh("npx ts-node ./scripts/dumpBids.ts");
  sh("npx ts-node ./scripts/debugEndAuctionNow.ts");
  sh("npx ts-node ./scripts/debugCloseAuction.ts");
  sh("npx ts-node ./scripts/debugOfferCascade.ts");

  header("SCENARIO 3: no bids -> close -> cascade");
  setEnv("LISTING_ID", "listing_seed_1");
  setEnv("AUCTION_ID", "auction_seed_gate_nobids_1");
  sh("npx ts-node ./scripts/seedListing.ts");
  sh("npx ts-node ./scripts/seedAuctionEnded.ts");
  sh("npx ts-node ./scripts/debugCloseAuction.ts");
  sh("npx ts-node ./scripts/debugOfferCascade.ts");

  header("PREFLIGHT GATE: PASS");
  console.log(JSON.stringify({ ok: true }, null, 2));
}

main().catch((e) => {
  console.error("PREFLIGHT GATE: FAIL");
  console.error(e);
  process.exit(1);
});
