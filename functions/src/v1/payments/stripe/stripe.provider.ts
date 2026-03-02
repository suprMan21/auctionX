import Stripe from "stripe"
import type { PaymentAuthCaptureInput, PaymentAuthCaptureOutput, PaymentProvider } from "../paymentProvider"

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env: ${name}`)
  return v
}

function currencyDefault(): string {
  return (process.env.STRIPE_CURRENCY || "cad").toLowerCase()
}

function idempotencyKey(parts: string[]): string {
  return parts.join(":").slice(0, 255)
}

export class StripePaymentProvider implements PaymentProvider {
  private stripe: Stripe

  constructor() {
    const key = requireEnv("STRIPE_SECRET_KEY")
    this.stripe = new Stripe(key)
  }

  async authorizeAndCapture(input: PaymentAuthCaptureInput): Promise<PaymentAuthCaptureOutput> {
    const currency = (input.currency || currencyDefault()).toLowerCase()

    const pi = await this.stripe.paymentIntents.create(
      {
        amount: input.amountCents,
        currency,
        capture_method: "manual",
        confirm: true,
        off_session: true,
        payment_method: input.paymentMethodRef,
        customer: input.customerRef,
        metadata: {
          settlementId: input.settlementId,
          buyerUid: input.buyerUid ?? "null",
          amountCents: String(input.amountCents),
          currency
        }
      },
      {
        idempotencyKey: idempotencyKey([input.settlementId, "AUTH", input.requestId])
      }
    )

    if (pi.status !== "requires_capture" && pi.status !== "succeeded") {
      throw new Error(`Unexpected PaymentIntent status after confirm: ${pi.status}`)
    }

    if (pi.status === "succeeded") {
      return {
        provider: "stripe",
        providerPaymentId: pi.id,
        providerChargeId: (pi.latest_charge as string) || undefined
      }
    }

    const captured = await this.stripe.paymentIntents.capture(
      pi.id,
      {},
      { idempotencyKey: idempotencyKey([input.settlementId, "CAPTURE", input.requestId]) }
    )

    if (captured.status !== "succeeded") {
      throw new Error(`Unexpected PaymentIntent status after capture: ${captured.status}`)
    }

    return {
      provider: "stripe",
      providerPaymentId: captured.id,
      providerChargeId: (captured.latest_charge as string) || undefined
    }
  }
}
