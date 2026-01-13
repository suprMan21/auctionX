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
  provider: string
  providerPaymentId: string
  providerChargeId?: string
}

export type PaymentFailure = {
  retryable: boolean
  code: string
  message: string
  provider?: string
  providerPaymentId?: string
}

export interface PaymentProvider {
  authorizeAndCapture(input: PaymentAuthCaptureInput): Promise<PaymentAuthCaptureOutput>
}
