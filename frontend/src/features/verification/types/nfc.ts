import { z } from 'zod';

// ── NFC Tag (mirrors nfc_tags Row, minus aes_key_enc) ──────────────────────

export interface NfcTag {
  id: string;
  tenant_id: string;
  tag_uid: string;
  item_id: string | null;
  seller_id: string;
  verification_id: string | null;
  status: 'registered' | 'active' | 'revoked';
  sun_counter: number;
  activated_at: string | null;
  created_at: string;
  updated_at: string;
}

// ── Verification Event (mirrors verification_events Row) ───────────────────

export interface VerificationEvent {
  id: string;
  tag_id: string;
  scan_type: string;
  scanned_by: string | null;
  sun_message: string | null;
  sun_counter_value: number | null;
  cmac_valid: boolean | null;
  ip_address: string | null;
  user_agent: string | null;
  video_proof_url: string | null;
  video_proof_status: string | null;
  created_at: string;
}

// ── NFT Metadata (mirrors nft_metadata Row) ────────────────────────────────

export interface NftMetadata {
  id: string;
  tag_id: string;
  chain: string;
  contract_address: string;
  token_id: string;
  mint_tx_hash: string | null;
  metadata_uri: string | null;
  metadata_json: Record<string, unknown> | null;
  owner_wallet: string | null;
  minted_at: string | null;
  created_at: string;
}

// ── Composite response from GET /nfc/:tagId ────────────────────────────────

export interface NfcTagDetail {
  tag: NfcTag;
  events: VerificationEvent[];
  nft: NftMetadata | null;
  verification: {
    id: string;
    token_name: string;
    status: string;
    scan_count: number;
    listing: {
      title: string;
      description: string | null;
      listing_media: Array<{ url: string; type: string; sort_order: number }>;
    } | null;
  } | null;
  seller: { display_name: string | null } | null;
}

// ── Scan result from POST /nfc/scan ────────────────────────────────────────

export interface ScanResult {
  valid: boolean;
  tagId: string;
  eventId: string | null;
  counterValue: number | null;
}

// ── Zod schemas for register form ──────────────────────────────────────────

export const tagUidSchema = z
  .string()
  .min(8, 'Tag UID must be at least 8 hex characters')
  .max(14, 'Tag UID must be at most 14 hex characters')
  .regex(/^[0-9a-fA-F]+$/, 'Tag UID must be a hex string');

export const aesKeySchema = z
  .string()
  .length(32, 'AES key must be exactly 32 hex characters')
  .regex(/^[0-9a-fA-F]+$/, 'AES key must be a hex string');

export const registerTagFormSchema = z.object({
  tagUid: tagUidSchema,
  aesKey: aesKeySchema,
  itemId: z.string().uuid('Must be a valid UUID').optional().or(z.literal('')),
});

export type RegisterTagFormData = z.infer<typeof registerTagFormSchema>;
