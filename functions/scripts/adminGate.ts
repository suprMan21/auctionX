import admin from "firebase-admin";
import { AdminOrchestrator } from "../src/v1/services/orchestration/admin.orchestrator";
import { DisputeSchema } from "../src/v1/schemas/domain/dispute.schema";

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

async function readDisputeVersion(db: FirebaseFirestore.Firestore, disputeId: string): Promise<number> {
  const snap = await db.collection("disputes").doc(disputeId).get();
  if (!snap.exists) throw new Error("adminGate: dispute missing after create");

  const parsed = DisputeSchema.safeParse({ id: snap.id, ...snap.data() });
  if (!parsed.success) {
    throw new Error("adminGate: dispute schema parse failed");
  }
  return parsed.data.version;
}

async function main() {
  mustEnv("FIRESTORE_EMULATOR_HOST");

  const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "demo-adminGate";

  if (!admin.apps.length) {
    admin.initializeApp({ projectId });
  }

  const db = admin.firestore();
  db.settings({ host: process.env.FIRESTORE_EMULATOR_HOST!, ssl: false });

  const orch = new AdminOrchestrator(db);

  const listingId = "listing_seed_1";
  const auctionId = "auction_seed_gate_2bidders_1";
  const disputeId = "dispute_admin_gate_1";

  const createRequestId = "adminGate-createDispute-1";

  await orch.createDisputeAdmin({
    requestId: createRequestId,
    actor: { kind: "HUMAN", uid: "admin_gate_actor_1" },
    justification: "Admin gate: create dispute for operational validation.",
    reasonCode: "DISPUTE_OPERATIONAL_RECOVERY",

    disputeId,

    listingId,
    auctionId,
    settlementId: null,
    payoutId: null,
    buyerUid: "user_2",
    sellerUid: "seller_seed_1",

    disputeReasonCode: "OTHER",
    reasonText: "Admin gate synthetic dispute",
    note: "adminGate",
  });

  const expectedVersion = await readDisputeVersion(db, disputeId);

  const cbRequestId = "adminGate-chargebackReported-1";

  await orch.recordChargebackFactAdmin({
    requestId: cbRequestId,
    actor: { kind: "HUMAN", uid: "admin_gate_actor_1" },
    justification: "Admin gate: record chargeback fact for validation.",
    reasonCode: "DISPUTE_CHARGEBACK_NOTICE_RECEIVED",

    disputeId,
    expectedVersion,

    fact: "REPORTED",
    amountCents: 12345,
    note: "adminGate chargeback reported",
    externalRef: { system: "TEST", id: "cb_1" },
  });

  console.log("============================================================");
  console.log("ADMIN GATE: PASS");
  console.log("============================================================");
  console.log(JSON.stringify({ ok: true }, null, 2));
}

main().catch((e) => {
  console.error("ADMIN GATE: FAIL");
  console.error(e);
  process.exit(1);
});
