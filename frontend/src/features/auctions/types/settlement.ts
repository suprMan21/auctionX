export type SettlementStatus =
  | 'PENDING_PAYMENT'
  | 'ESCROW_HOLD'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'RELEASED'
  | 'DISPUTED';

export type OfferStatus =
  | 'PENDING_PAYMENT'
  | 'ACCEPTED'
  | 'DECLINED'
  | 'EXPIRED'
  | 'CANCELLED';

export interface Settlement {
  id: string;
  auction_id: string;
  seller_id: string;
  buyer_id: string | null;
  gross_amount_cents: number;
  platform_fee_cents: number;
  processor_fee_cents: number;
  net_amount_cents: number;
  platform_fee_percent: number;
  processor_fee_percent: number;
  status: SettlementStatus;
  payment_window_expires_at: string | null;
  transaction_id: string | null;
  offer_attempt: number;
  created_at: string;
  updated_at: string;
  settled_at: string | null;
  escrow_ends_at: string | null;
  escrow_released_at: string | null;
  dispute_reason: string | null;
  dispute_opened_at: string | null;
  auction?: {
    id: string;
    listing_id: string;
    current_price_cents: number;
    currency: string;
    status: string;
  };
  offers?: SettlementOffer[];
  /** Determined server-side based on authenticated user */
  role?: 'buyer' | 'seller';
}

export interface SettlementOffer {
  id: string;
  settlement_id: string;
  bidder_id: string;
  offer_price_cents: number;
  offer_rank: number;
  status: OfferStatus;
  payment_window_expires_at: string;
  transaction_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuctionSettlementSummary {
  settlementId: string;
  status: SettlementStatus;
  buyerId: string | null;
  activeOfferId: string | null;
  paymentWindowExpiresAt: string | null;
}
