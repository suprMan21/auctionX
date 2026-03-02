import { db } from "../src/v1/lib/firebaseAdmin"
import { orchCreateSettlementFromAuctionClose, orchCollectAndPay } from "../src/v1/services/orchestration/settlement.orchestrator"

type GateResult = { ok: true } | { ok: false; error: any }

function fail(error: any): GateResult {
  return { ok: false, error }
}

function nowMs() {
  return Date.now()
}

function settlementRef(settlementId: string) {
  return db.doc(`settlements/${settlementId}`)
}

async function wipeSettlement(settlementId: string) {
  const ref = settlementRef(settlementId)
  await ref.delete().catch(() => undefined)
}

async function main() {
  console.log("============================================================")
  console.log("PAYMENT GATE")
  console.log("============================================================")
  console.log("")
  console.log("This gate expects:")
  console.log("- FIRESTORE_EMULATOR_HOST set")
  console.log("- STRIPE_SECRET_KEY set (test key)")
  console.log("- STRIPE_CURRENCY set (cad)")
  console.log("")

  const listingId = "listing_seed_1"
  const auctionId = "auction_seed_gate_2bidders_1"
  const settlementId = auctionId

  await wipeSettlement(settlementId)

  const createRes = await orchCreateSettlementFromAuctionClose({
    requestId: "gate-createSettlement",
    listingId,
    auctionId,
  })

  if (!createRes.ok) return console.log(JSON.stringify(fail(createRes.error), null, 2))
  const settlement = createRes.value.settlement

  if (settlement.outcomeKind !== "PAYMENT_REQUIRED") {
    throw new Error(`Expected PAYMENT_REQUIRED but got ${settlement.outcomeKind}`)
  }
  if (settlement.status !== "ACTION_REQUIRED") {
    throw new Error(`Expected ACTION_REQUIRED but got ${settlement.status}`)
  }

  const payRes = await orchCollectAndPay({
    requestId: "gate-collectAndPay",
    settlementId,
    listingId,
    auctionId,
    expectedVersion: settlement.version,
    paymentMethodRef: "pm_card_visa",
  })

  if (!payRes.ok) return console.log(JSON.stringify(fail(payRes.error), null, 2))

  const snap = await settlementRef(settlementId).get()
  if (!snap.exists) throw new Error("Settlement missing after collectAndPay")
  const data = snap.data() as any

  if (data.status !== "SETTLED") {
    throw new Error(`Expected settlement status SETTLED but got ${data.status}`)
  }

  console.log("============================================================")
  console.log("PAYMENT GATE: PASS")
  console.log("============================================================")
  console.log(JSON.stringify({ ok: true, settlementId, atMs: nowMs() }, null, 2))
}

main().catch((e) => {
  console.error("============================================================")
  console.error("PAYMENT GATE: FAIL")
  console.error("============================================================")
  console.error(e)
  process.exit(1)
})
