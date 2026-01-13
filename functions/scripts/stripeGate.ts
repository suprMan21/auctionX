import Stripe from "stripe"

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env: ${name}`)
  return v
}

async function main() {
  const key = requireEnv("STRIPE_SECRET_KEY")
  const stripe = new Stripe(key)

  const currency = (process.env.STRIPE_CURRENCY || "cad").toLowerCase()

  const requestId = "stripe-gate"
  const settlementId = "settlement_stripe_gate_1"
  const amountCents = 500
  const paymentMethod = "pm_card_visa"

  const pi = await stripe.paymentIntents.create(
    {
      amount: amountCents,
      currency,
      capture_method: "manual",
      confirm: true,
      off_session: true,
      payment_method: paymentMethod,
      metadata: { settlementId, requestId }
    },
    { idempotencyKey: `${settlementId}:AUTH:${requestId}`.slice(0, 255) }
  )

  if (pi.status !== "requires_capture" && pi.status !== "succeeded") {
    throw new Error(`Unexpected status after confirm: ${pi.status}`)
  }

  if (pi.status === "requires_capture") {
    const captured = await stripe.paymentIntents.capture(
      pi.id,
      {},
      { idempotencyKey: `${settlementId}:CAPTURE:${requestId}`.slice(0, 255) }
    )

    if (captured.status !== "succeeded") throw new Error(`Unexpected status after capture: ${captured.status}`)
  }

  console.log("============================================================")
  console.log("STRIPE GATE: PASS")
  console.log("============================================================")
  console.log(JSON.stringify({ ok: true, paymentIntentId: pi.id }, null, 2))
}

main().catch((e) => {
  console.error("============================================================")
  console.error("STRIPE GATE: FAIL")
  console.error("============================================================")
  console.error(e)
  process.exit(1)
})
