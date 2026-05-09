export type VerificationStatus =
  | 'PENDING'
  | 'VIDEO_UPLOADED'
  | 'NFC_PROGRAMMED'
  | 'VERIFIED'
  | 'FLAGGED'
  | 'REVOKED';

export type TransferType = 'SALE' | 'GIFT' | 'RETURN';

export interface Verification {
  id: string;
  listing_id: string;
  seller_id: string;
  token_name: string;
  nfc_tag_uid: string | null;
  video_url: string | null;
  video_duration_seconds: number | null;
  status: VerificationStatus;
  scan_count: number;
  view_count: number;
  share_count: number;
  current_owner_id: string | null;
  nfc_programmed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface NftData {
  chain: string;
  contract_address: string;
  token_id: string;
  mint_tx_hash: string;
  metadata_uri: string | null;
}

export interface OwnershipTransfer {
  id: string;
  verification_id: string;
  from_user_id: string | null;
  to_user_id: string;
  transfer_type: TransferType;
  settlement_id: string | null;
  transferred_at: string;
  from_username: string | null;
  to_username: string | null;
}

export interface VerificationDetail extends Verification {
  listing: {
    title: string;
    description: string | null;
    listing_media: Array<{ url: string; type: string; sort_order: number }>;
  } | null;
  ownership_transfers: OwnershipTransfer[];
  seller: { username: string } | null;
  current_owner: { username: string } | null;
  nft: NftData | null;
}
