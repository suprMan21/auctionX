import { StripePaymentProvider } from "../payments/stripe/stripe.provider"
import { mapStripeError } from "../payments/stripe/stripe.errors"

// TODO: wire these imports to your Module 06 settlement orchestration functions.
// The names below are expected capabilities, not enforced names.
/*
import {
  getSettlementOrThrow,
  recordSettlementFailure,
  markSettlementSettled
} from "../orch/settlement.orch"
*/

export type CollectAndPayInput = {
  requestId: string
  settlementId: string
  expectedVersion: number
  paymentMethodRef: string
  customerRef?: string
}

export async function collectAndPay(input: CollectAndPayInput): Promise<{ ok: true }> {
  const provider = new StripePaymentProvider()

  const startedAt = Date.now()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const settlement: any = await (global as any).__UNMEN_GET_SETTLEMENT__(input.settlementId)

  if (!settlement) throw new Error(`Settlement not found: ${input.settlementId}`)

  if (settlement.outcomeKind !== "PAYMENT_REQUIRED") throw new Error(`Settlement not payment-required: ${input.settlementId}`)
  if (settlement.status !== "ACTION_REQUIRED") throw new Error(`Settlement not action-required: ${input.settlementId}`)
  if (settlement.action !== "COLLECT_AND_PAY") throw new Error(`Settlement not COLLECT_AND_PAY: ${input.settlementId}`)

  const buyerUid = settlement.winnerUid ?? null
  const amountCents = settlement.winningPriceCents
  const currency = settlement.currency || "CAD"

  try {
    const res = await provider.authorizeAndCapture({
      requestId: input.requestId,
      settlementId: input.settlementId,
      amountCents,
      currency,
      buyerUid,
      paymentMethodRef: input.paymentMethodRef,
      customerRef: input.customerRef
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (global as any).__UNMEN_MARK_SETTLED__(
      input.settlementId,
      { requestId: input.requestId, expectedVersion: input.expectedVersion, provider: res.provider, providerPaymentId: res.providerPaymentId }
    )

    void startedAt
    return { ok: true }
  } catch (e) {
    const failure = mapStripeError(e)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (global as any).__UNMEN_RECORD_SETTLEMENT_FAILURE__(
      input.settlementId,
      { requestId: input.requestId, expectedVersion: input.expectedVersion, ...failure }
    )

    throw e
  }
}
