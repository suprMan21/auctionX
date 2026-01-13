import admin from "firebase-admin";
import { DisputeOrchestrator } from "../src/v1/services/orchestration/dispute.orchestrator";

function must(cond: any, msg: string) {
  if (!cond) throw new Error(msg);
}

async function main() {
  if (!admin.apps.length) {
    admin.initializeApp({
      projectId: process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT,
    } as any);
  }

  const db = admin.firestore();
  db.settings({
    host: process.env.FIRESTORE_EMULATOR_HOST,
    ssl: false,
  } as any);

  const orch = new DisputeOrchestrator(db);

  const disputeId = "dispute_gate_1";
  const payoutId = "payout_gate_1";

  const created = await orch.createDispute({
    requestId: "dispute-gate-create",
    disputeId,
    listingId: "listing_seed_1",
    auctionId: "auction_seed_gate_2bidders_1",
    settlementId: "settlement_gate_1",
    payoutId,
    buyerUid: "user_2",
    sellerUid: "seller_seed_1",
    reasonCode: "NOT_AS_DESCRIBED",
    reasonText: "gate test",
    actor: "SYSTEM",
    note: "gate create",
  });

  must(created.dispute.id === disputeId, "create failed");
  must(created.dispute.version === 0, "create version wrong");

  const held = await orch.placeHold({
    requestId: "dispute-gate-hold",
    disputeId,
    expectedVersion: created.dispute.version,
    actor: "SYSTEM",
    note: "place hold",
  });

  must(held.dispute.hold.status === "PLACED", "hold not placed");

  let releaseCalled = 0;
  const blocked = await orch.releasePayoutIfNoActiveDisputeHold({
    requestId: "dispute-gate-release-blocked",
    payoutId,
    release: async () => {
      releaseCalled += 1;
      return { ok: true };
    },
  });

  must(blocked.ok === true, "wrapper failed");
  must(blocked.blocked === true, "should be blocked");
  must(releaseCalled === 0, "release should not be called when blocked");

  const unheld = await orch.releaseHold({
    requestId: "dispute-gate-unhold",
    disputeId,
    expectedVersion: held.dispute.version,
    actor: "SYSTEM",
    note: "release hold",
  });

  must(unheld.dispute.hold.status === "RELEASED", "hold not released");

  const allowed = await orch.releasePayoutIfNoActiveDisputeHold({
    requestId: "dispute-gate-release-allowed",
    payoutId,
    release: async () => {
      releaseCalled += 1;
      return { ok: true };
    },
  });

  must(allowed.ok === true, "wrapper failed (allowed)");
  must(allowed.blocked === false, "should not be blocked after release");
  must(releaseCalled === 1, "release should be called once when allowed");

  console.log("============================================================");
  console.log("DISPUTE GATE: PASS");
  console.log("============================================================");
  console.log(JSON.stringify({ ok: true }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
