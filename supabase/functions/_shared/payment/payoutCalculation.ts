/**
 * payoutCalculation.ts
 *
 * Shared utility for computing seller payout amounts after platform and
 * processor fees are deducted. Used by release-escrow and any future
 * payout-related edge functions.
 */

export type ProcessorKey =
  | 'STRIPE'
  | 'PAYMENTCLOUD'
  | 'SIGNATURE'
  | 'CCBILL'
  | 'NOWPAYMENTS';

/** Processor fee rates (percentage of gross as a decimal, e.g. 0.029 = 2.9%) */
const PROCESSOR_FEE_RATES: Record<ProcessorKey, number> = {
  STRIPE: 0.029,        // 2.9% + fixed, approximated here as 2.9%
  PAYMENTCLOUD: 0.035,  // 3.5%
  SIGNATURE: 0.04,      // 4%
  CCBILL: 0.05,         // 5%
  NOWPAYMENTS: 0.01,    // 1% (crypto)
};

export interface PayoutBreakdown {
  grossAmountCents: number;
  platformFeeCents: number;
  processorFeeCents: number;
  netPayoutCents: number;
}

/**
 * Calculate payout breakdown for a settled auction.
 *
 * @param grossAmountCents  - Total amount paid by the buyer (in cents)
 * @param platformFeeCents  - Platform fee already recorded on the settlement
 * @param processor         - The processor that successfully collected payment
 */
export function calculatePayout(
  grossAmountCents: number,
  platformFeeCents: number,
  processor: string,
): PayoutBreakdown {
  const processorKey = (processor.toUpperCase() as ProcessorKey);
  const feeRate = PROCESSOR_FEE_RATES[processorKey] ?? PROCESSOR_FEE_RATES['STRIPE'];

  const processorFeeCents = Math.round(grossAmountCents * feeRate);
  const netPayoutCents = Math.max(0, grossAmountCents - platformFeeCents - processorFeeCents);

  return {
    grossAmountCents,
    platformFeeCents,
    processorFeeCents,
    netPayoutCents,
  };
}
