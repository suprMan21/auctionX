import admin from "firebase-admin";
import { DisputeOrchestrator } from "../src/v1/services/orchestration/dispute.orchestrator";

function must(cond: any, msg: string) {
  if (!cond) throw new Error(msg);
}

async function main() {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("FIRESTORE_EMULATOR_HOST must be set");
  }

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

  const runId = Date.now();
  const disputeId = `dispute_gate_${runId}`;
  const payoutId = `payout_gate_${runId}`;
  const createRequestId = `dispute-gate-create-${runId}`;

  const created1 = await orch.createDispute({
    requestId: createRequestId,
    disputeId,
    listingId: "listing_seed_1",
    auctionId: "auction_seed_gate_2bidders_1",
    settlementId: "auction_seed_gate_2bidders_1",
    payoutId,
    buyerUid: "user_2",
    sellerUid: "seller_seed_1",
    reasonCode: "NOT_AS_DESCRIBED",
    reasonText: "gate test",
    actor: "SYSTEM",
    note: "gate create",
  });

  must(created1.dispute.id === disputeId, "create failed");
  must(created1.dispute.version === 0, "create version wrong");

  const created2 = await orch.createDispute({
    requestId: createRequestId,
    disputeId,
    listingId: "listing_seed_1",
    auctionId: "auction_seed_gate_2bidders_1",
    settlementId: "auction_seed_gate_2bidders_1",
    payoutId,
    buyerUid: "user_2",
    sellerUid: "seller_seed_1",
    reasonCode: "NOT_AS_DESCRIBED",
    reasonText: "gate test",
    actor: "SYSTEM",
    note: "gate create (idempotency)",
  });

  must(created2.dispute.id === disputeId, "idempotent create failed");
  must(created2.dispute.version === 0, "idempotent create should not bump version");

  const held = await orch.placeHold({
    requestId: `dispute-gate-hold-${runId}`,
    disputeId,
    expectedVersion: 0,
    actor: "SYSTEM",
    note: "place hold",
  });

  must(held.dispute.hold.status === "PLACED", "hold not placed");
  must(held.dispute.version === 1, "hold version wrong");

  let releaseCalled = 0;
  const blocked = await orch.releasePayoutIfNoActiveDisputeHold({
    requestId: `dispute-gate-release-blocked-${runId}`,
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
    requestId: `dispute-gate-unhold-${runId}`,
    disputeId,
    expectedVersion: 1,
    actor: "SYSTEM",
    note: "release hold",
  });

  must(unheld.dispute.hold.status === "RELEASED", "hold not released");
  must(unheld.dispute.version === 2, "release version wrong");

  const allowed = await orch.releasePayoutIfNoActiveDisputeHold({
    requestId: `dispute-gate-release-allowed-${runId}`,
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
