import Stripe from "stripe"
import type { PaymentFailure } from "../paymentProvider"

export function mapStripeError(err: unknown): PaymentFailure {
  if (err instanceof Stripe.errors.StripeCardError) {
    return {
      retryable: false,
      code: err.decline_code || err.code || "CARD_ERROR",
      message: err.message || "Card declined",
      provider: "stripe",
      providerPaymentId: err.payment_intent?.id
    }
  }

  if (err instanceof Stripe.errors.StripeRateLimitError) {
    return { retryable: true, code: err.code || "RATE_LIMIT", message: err.message || "Rate limited", provider: "stripe" }
  }

  if (err instanceof Stripe.errors.StripeAPIError) {
    return { retryable: true, code: err.code || "STRIPE_API_ERROR", message: err.message || "Stripe API error", provider: "stripe" }
  }

  if (err instanceof Stripe.errors.StripeConnectionError) {
    return { retryable: true, code: err.code || "CONNECTION_ERROR", message: err.message || "Stripe connection error", provider: "stripe" }
  }

  if (err instanceof Stripe.errors.StripeInvalidRequestError) {
    return { retryable: false, code: err.code || "INVALID_REQUEST", message: err.message || "Stripe invalid request", provider: "stripe" }
  }

  if (err instanceof Stripe.errors.StripeAuthenticationError) {
    return { retryable: false, code: err.code || "AUTH_ERROR", message: err.message || "Stripe auth error", provider: "stripe" }
  }

  const msg = err instanceof Error ? err.message : "Unknown payment error"
  return { retryable: true, code: "UNKNOWN", message: msg, provider: "stripe" }
}
