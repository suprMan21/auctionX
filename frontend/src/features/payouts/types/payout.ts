export type PayoutStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'ON_HOLD';
export type PayoutMethod = 'STRIPE_CONNECT' | 'BANK_TRANSFER' | 'CRYPTO' | 'MANUAL';

export interface Payout {
  id: string;
  settlement_id: string;
  seller_id: string;
  gross_amount_cents: number;
  platform_fee_cents: number;
  processor_fee_cents: number;
  net_payout_cents: number;
  payout_method: PayoutMethod;
  payout_processor_id: string | null;
  status: PayoutStatus;
  eligible_at: string;
  initiated_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  failure_reason: string | null;
  currency: string;
  created_at: string;
  updated_at: string;
  // Joined fields (optional)
  settlement?: {
    auction_id: string;
    auctions?: { listing_id: string; listings?: { title: string } | null } | null;
  } | null;
}

export interface PayoutSummary {
  totalEarned: number;
  pendingEscrow: number;
  nextEligibleAt: string | null;
}
