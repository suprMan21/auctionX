import type { SupabaseClient } from '@supabase/supabase-js';
import { getStripe } from './stripe';

export type RefundOutcome =
  | {
      success: true;
      refundId: string;
      processor: 'STRIPE';
      amountCents: number;
      status: string;
    }
  | {
      success: false;
      processor: 'STRIPE' | 'UNSUPPORTED';
      errorMessage: string;
      errorCode: 'NO_TRANSACTION' | 'NO_PAYMENT_INTENT' | 'UNSUPPORTED_PROCESSOR' | 'STRIPE_ERROR';
    };

interface RefundInput {
  settlementId: string;
  /** Omit for full refund; pass amount in cents for partial. */
  amountCents?: number;
  /** UUID of admin who triggered the refund — recorded in refunds.initiated_by. */
  initiatedBy: string;
}

/**
 * Refund the buyer for a settlement.
 *
 * Looks up settlements.transaction_id → transactions.successful_payment_id
 * (the Stripe payment_intent ID) and invokes stripe.refunds.create.
 * Inserts a row into the refunds table on success for reconciliation.
 *
 * Only Stripe is wired this session — PaymentCloud / Signature / CCBill / NOWPayments
 * are awaiting live API keys (MODULE_STATUS.md). Refund attempts on those processors
 * return UNSUPPORTED_PROCESSOR so admin can fall back to the processor's portal.
 */
export async function refundSettlement(
  supabase: SupabaseClient,
  input: RefundInput,
): Promise<RefundOutcome> {
  const { settlementId, amountCents, initiatedBy } = input;

  const { data: settlement, error: settlementError } = await supabase
    .from('settlements')
    .select('id, transaction_id, gross_amount_cents')
    .eq('id', settlementId)
    .maybeSingle();

  if (settlementError || !settlement || !settlement.transaction_id) {
    return {
      success: false,
      processor: 'STRIPE',
      errorMessage: 'Settlement has no linked transaction',
      errorCode: 'NO_TRANSACTION',
    };
  }

  const { data: transaction, error: txError } = await supabase
    .from('transactions')
    .select('id, successful_processor, successful_payment_id')
    .eq('id', settlement.transaction_id)
    .maybeSingle();

  if (txError || !transaction) {
    return {
      success: false,
      processor: 'STRIPE',
      errorMessage: 'Transaction not found',
      errorCode: 'NO_TRANSACTION',
    };
  }

  if (transaction.successful_processor !== 'STRIPE') {
    return {
      success: false,
      processor: 'UNSUPPORTED',
      errorMessage: `Refund automation not implemented for processor '${transaction.successful_processor ?? 'unknown'}'. Process manually via the processor portal.`,
      errorCode: 'UNSUPPORTED_PROCESSOR',
    };
  }

  if (!transaction.successful_payment_id) {
    return {
      success: false,
      processor: 'STRIPE',
      errorMessage: 'Transaction missing successful_payment_id (Stripe payment_intent)',
      errorCode: 'NO_PAYMENT_INTENT',
    };
  }

  try {
    const stripe = getStripe();
    const refund = await stripe.refunds.create({
      payment_intent: transaction.successful_payment_id,
      amount: amountCents,
      reason: 'requested_by_customer',
      metadata: {
        settlementId,
        transactionId: transaction.id,
      },
    });

    await supabase.from('refunds').insert({
      transaction_id: transaction.id,
      processor: 'STRIPE',
      processor_refund_id: refund.id,
      amount_cents: refund.amount,
      reason: 'requested_by_customer',
      initiated_by: initiatedBy,
    });

    return {
      success: true,
      refundId: refund.id,
      processor: 'STRIPE',
      amountCents: refund.amount,
      status: refund.status ?? 'unknown',
    };
  } catch (err) {
    return {
      success: false,
      processor: 'STRIPE',
      errorMessage: err instanceof Error ? err.message : 'Stripe refund failed',
      errorCode: 'STRIPE_ERROR',
    };
  }
}
