/**
 * Verification types shared by the seller-verification feature module.
 *
 * As of S22 the doc-upload pipeline is superseded by Yoti hosted IDV. The
 * legacy fields (DocumentType / VerificationDocument / DOCUMENT_LABELS) stay
 * exported because the admin doc-pipeline page still reads them. The new
 * Yoti-driven status type adds VERIFIED (the canonical post-Yoti success
 * state — VERIFIED is what the DB writes, APPROVED is the legacy doc-pipeline
 * approval flag, both render as "Verified" in the UI).
 */
/**
 * Mirrors the `verification_status` enum in database.types.ts so the frontend
 * can render any state the DB might produce (Yoti + legacy doc + NFC pipelines).
 * The badge/banner components default unknown values gracefully.
 */
export type VerificationStatus =
  | 'NONE'
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'VIDEO_UPLOADED'
  | 'NFC_PROGRAMMED'
  | 'VERIFIED'
  | 'REVOKED'
  | 'FLAGGED';

export type DocumentType = 'government_id' | 'selfie_with_id' | 'proof_of_address' | 'business_license';

export interface VerificationDocument {
  id: string;
  document_type: DocumentType;
  file_url: string;
  mime_type: string;
  file_size_bytes: number | null;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
}

export interface VerificationStatusResponse {
  status: VerificationStatus;
  submittedAt: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  documents: VerificationDocument[];
}

export interface DocumentUploadUrlResponse {
  uploadUrl: string;
  publicUrl: string;
  s3Key: string;
}

export const DOCUMENT_LABELS: Record<DocumentType, { label: string; description: string; required: boolean }> = {
  government_id: {
    label: 'Government-Issued ID',
    description: 'Driver\'s license, passport, or national ID card (front side)',
    required: true,
  },
  selfie_with_id: {
    label: 'Selfie with ID',
    description: 'Clear photo of yourself holding your government ID',
    required: true,
  },
  proof_of_address: {
    label: 'Proof of Address',
    description: 'Utility bill or bank statement from the last 3 months',
    required: false,
  },
  business_license: {
    label: 'Business License',
    description: 'Optional — for registered business sellers',
    required: false,
  },
};

/** Treat both VERIFIED (Yoti) + APPROVED (legacy) as "user is a seller". */
export const isSellerVerified = (status: VerificationStatus | null | undefined): boolean =>
  status === 'VERIFIED' || status === 'APPROVED';
