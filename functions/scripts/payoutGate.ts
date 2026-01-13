import { createPayoutFromSettlement, releasePayout } from "../src/v1/services/orchestration/payout.orchestrator";
import { getPayout, findLatestSettledSettlementId } from "../src/v1/repos/payouts.repo";

function header(name: string) {
  const line = "=".repeat(60);
  console.log("");
  console.log(line);
  console.log(name);
  console.log(line);
  console.log("");
}

function assertOk(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION_FAILED: ${msg}`);
}

function unwrap<T>(
  r: { ok: true; value: T } | { ok: false; error: { code: string; message: string } },
  label: string
): T {
  if (!r.ok) throw new Error(`${label}: ${r.error.code} ${r.error.message}`);
  return r.value;
}

async function main() {
  header("PAYOUT GATE");

  process.env.PAYOUT_PLATFORM_FEE_BPS = process.env.PAYOUT_PLATFORM_FEE_BPS || "0";
  process.env.PAYOUT_PLATFORM_FEE_FIXED_CENTS = process.env.PAYOUT_PLATFORM_FEE_FIXED_CENTS || "0";
  process.env.PAYOUT_SELLER_WITHHOLDING_BPS = process.env.PAYOUT_SELLER_WITHHOLDING_BPS || "0";
  process.env.PAYOUT_PLATFORM_FEE_TAX_BPS = process.env.PAYOUT_PLATFORM_FEE_TAX_BPS || "0";
  process.env.PAYOUT_FEE_RULESET_VERSION = process.env.PAYOUT_FEE_RULESET_VERSION || "FEE_V1";
  process.env.PAYOUT_TAX_RULESET_VERSION = process.env.PAYOUT_TAX_RULESET_VERSION || "TAX_V1";

  header("PAYOUT GATE: sanity - latest SETTLED settlement");
  const latest = await findLatestSettledSettlementId();
  const settlementId = unwrap(latest, "findLatestSettledSettlementId");
  assertOk(!!settlementId, "no SETTLED settlement found (run settlement/payment gate first)");
  console.log(JSON.stringify({ settlementId }, null, 2));

  process.env.SETTLEMENT_ID = settlementId;

  const requestId = "payout-gate";
  const logger = { info() {}, warn() {}, error() {} } as any;

  header("PAYOUT GATE: create payout (script supplies settlementId)");
  const created = await createPayoutFromSettlement({ logger, requestId, settlementId });
  const payout = unwrap(created, "createPayoutFromSettlement").payout;
  console.log("PAYOUT:", payout);

  header("PAYOUT GATE: release payout");
  const released = await releasePayout({
    logger,
    requestId: "payout-gate-release",
    payoutId: payout.id,
    expectedVersion: payout.version,
  });
  const finalPayout = unwrap(released, "releasePayout").payout;

  assertOk(
    finalPayout.status === "RELEASED" || finalPayout.status === "VOIDED",
    `expected RELEASED or VOIDED, got ${finalPayout.status}`
  );

  header("PAYOUT GATE: idempotency re-run (create)");
  const createdAgain = await createPayoutFromSettlement({ logger, requestId: "payout-gate-again", settlementId });
  const payoutAgain = unwrap(createdAgain, "createPayoutFromSettlement again").payout;
  assertOk(payoutAgain.id === payout.id, "expected same payout id on idempotent create");

  header("PAYOUT GATE: read back");
  const readBack = await getPayout(payout.id);
  const readVal = unwrap(readBack, "getPayout");
  assertOk(!!readVal, "payout missing after create/release");

  header("PAYOUT GATE: PASS");
  console.log(JSON.stringify({ ok: true, settlementId, payoutId: payout.id }, null, 2));
}

main().catch((e) => {
  console.error("PAYOUT GATE: FAIL");
  console.error(e);
  process.exit(1);
});
