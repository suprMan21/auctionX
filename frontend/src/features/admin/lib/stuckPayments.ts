/** S-ADMIN1 Ph3a: shared bits for the stuck-payment queue and its dialogs. */

import { formatAmount } from './display';

/** What an admin types to confirm a refund: the end of the payment id. */
export const INTENT_SUFFIX_LENGTH = 6;
export const intentSuffix = (paymentIntentId: string): string => paymentIntentId.slice(-INTENT_SUFFIX_LENGTH);

/** Amounts arrive in minor units (cents). */
export const moneyOf = (amount: number | null, currency: string | null): string =>
  amount === null ? 'the fee' : formatAmount(amount, currency);
