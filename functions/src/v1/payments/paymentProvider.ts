export type PaymentAuthCaptureInput = {
  requestId: string
  settlementId: string
  amountCents: number
  currency: string
  buyerUid: string | null
  paymentMethodRef: string
  customerRef?: string
}

export type PaymentAuthCaptureOutput = {
  provider: "stripe"
  providerPaymentId: string
  providerChargeId?: string
}

export type PaymentFailure = {
  retryable: boolean
  code: string
  message: string
  provider: "stripe"
  providerPaymentId?: string
}

export interface PaymentProvider {
  authorizeAndCapture(input: PaymentAuthCaptureInput): Promise<PaymentAuthCaptureOutput>
}
