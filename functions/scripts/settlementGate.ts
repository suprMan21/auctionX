import { strict as assert } from "node:assert";
import { db } from "../src/v1/lib/firebaseAdmin";
import {
  orchCreateSettlementFromAuctionClose,
  orchGetSettlement,
  orchMarkSettlementSettled,
  orchRecordSettlementFailure,
  orchStartSettlement,
} from "../src/v1/services/orchestration/settlement.orchestrator";

type Scenario = {
  name: string;
  listingId: string;
  auctionId: string;
  expectedKind: "PAYMENT_REQUIRED" | "NO_BIDS";
};

const scenarios: Scenario[] = [
  { name: "2 bidders", listingId: "listing_seed_1", auctionId: "auction_seed_gate_2bidders_1", expectedKind: "PAYMENT_REQUIRED" },
  { name: "3 bidders", listingId: "listing_seed_1", auctionId: "auction_seed_gate_3bidders_1", expectedKind: "PAYMENT_REQUIRED" },
  { name: "no bids", listingId: "listing_seed_1", auctionId: "auction_seed_gate_nobids_1", expectedKind: "NO_BIDS" },
];

function rid(s: string) {
  return `settlementGate-${s.replace(/\s+/g, "_")}`;
}

function unwrap<T>(res: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T {
  if (!res.ok) throw new Error(`${res.error.code}: ${res.error.message}`);
  return res.value;
}

async function wipeSettlement(settlementId: string) {
  await db.doc(`settlements/${settlementId}`).delete();
}

async function runScenario(s: Scenario) {
  console.log("------------------------------------------------------------");
  console.log(`SCENARIO: ${s.name} -> create settlement -> validate -> advance`);
  console.log("------------------------------------------------------------");

  await wipeSettlement(s.auctionId);

  const created = unwrap(
    await orchCreateSettlementFromAuctionClose({
      requestId: rid(`${s.name}-create`),
      listingId: s.listingId,
      auctionId: s.auctionId,
    })
  );

  const settlementId = created.settlement.id;

  const got = unwrap(
    await orchGetSettlement({
      requestId: rid(`${s.name}-get`),
      settlementId,
      listingId: s.listingId,
      auctionId: s.auctionId,
    })
  );

  assert.ok(got.settlement, `settlement missing for ${s.name}`);

  const st = got.settlement!;
  assert.equal(st.id, s.auctionId);
  assert.equal(st.auctionId, s.auctionId);
  assert.equal(st.listingId, s.listingId);
  assert.equal(st.outcomeKind, s.expectedKind);

  if (s.expectedKind === "NO_BIDS") {
    assert.equal(st.status, "VOIDED");
    assert.equal(st.actions.length, 0);
    console.log("ASSERT: NO_BIDS -> VOIDED, no actions ✅");
    return;
  }

  assert.equal(st.actions.length, 1);
  assert.equal(st.actions[0].type, "COLLECT_AND_PAY");
  console.log("ASSERT: PAYMENT_REQUIRED -> action present ✅");

  const started = unwrap(
    await orchStartSettlement({
      requestId: rid(`${s.name}-start`),
      settlementId,
      listingId: s.listingId,
      auctionId: s.auctionId,
      expectedVersion: st.version,
    })
  );

  assert.equal(started.settlement.status, "IN_PROGRESS");
  console.log("ASSERT: start -> IN_PROGRESS ✅");

  const failed = unwrap(
    await orchRecordSettlementFailure({
      requestId: rid(`${s.name}-fail-retryable`),
      settlementId,
      listingId: s.listingId,
      auctionId: s.auctionId,
      expectedVersion: started.settlement.version,
      retryable: true,
      code: "SIMULATED",
      message: "Simulated retryable failure",
    })
  );

  assert.equal(failed.settlement.status, "FAILED_RETRYABLE");
  assert.equal(failed.settlement.actions[0].status, "FAILED");
  assert.equal(failed.settlement.actions[0].attempts.length >= 1, true);
  console.log("ASSERT: retryable failure -> FAILED_RETRYABLE ✅");

  const started2 = unwrap(
    await orchStartSettlement({
      requestId: rid(`${s.name}-start2`),
      settlementId,
      listingId: s.listingId,
      auctionId: s.auctionId,
      expectedVersion: failed.settlement.version,
    })
  );

  assert.equal(started2.settlement.status, "IN_PROGRESS");
  console.log("ASSERT: restart -> IN_PROGRESS ✅");

  const settled = unwrap(
    await orchMarkSettlementSettled({
      requestId: rid(`${s.name}-settled`),
      settlementId,
      listingId: s.listingId,
      auctionId: s.auctionId,
      expectedVersion: started2.settlement.version,
    })
  );

  assert.equal(settled.settlement.status, "SETTLED");
  assert.equal(settled.settlement.actions[0].status, "SUCCEEDED");
  console.log("ASSERT: markSettled -> SETTLED ✅");
}

async function main() {
  console.log("============================================================");
  console.log("SETTLEMENT GATE");
  console.log("============================================================");

  for (const s of scenarios) {
    await runScenario(s);
  }

  console.log("============================================================");
  console.log("SETTLEMENT GATE: PASS");
  console.log("============================================================");
  console.log({ ok: true });
}

main().catch((e) => {
  console.error("SETTLEMENT GATE: FAIL");
  console.error(e);
  process.exit(1);
});
