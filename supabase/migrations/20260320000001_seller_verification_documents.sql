-- Phase 7A: Seller Verification Documents & Reviews
-- Creates tables for document upload tracking and admin review audit trail.

-- 1. seller_verification_documents
CREATE TABLE IF NOT EXISTS public.seller_verification_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL CHECK (document_type IN ('government_id', 'selfie_with_id', 'proof_of_address', 'business_license')),
  s3_key TEXT NOT NULL,
  file_url TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'application/pdf')),
  file_size_bytes INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. seller_verification_reviews (audit trail)
CREATE TABLE IF NOT EXISTS public.seller_verification_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  admin_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('approve', 'reject', 'revoke', 'request_resubmit')),
  notes TEXT NOT NULL,
  previous_status TEXT NOT NULL,
  new_status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Enable RLS
ALTER TABLE public.seller_verification_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_verification_reviews ENABLE ROW LEVEL SECURITY;

-- 4. RLS policies — seller_verification_documents
-- Users can read their own documents
CREATE POLICY "Users can view own verification documents"
  ON public.seller_verification_documents
  FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert documents for themselves
CREATE POLICY "Users can upload own verification documents"
  ON public.seller_verification_documents
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can delete own documents (controller enforces status check)
CREATE POLICY "Users can delete own verification documents"
  ON public.seller_verification_documents
  FOR DELETE
  USING (auth.uid() = user_id);

-- Service role handles admin updates (no user-facing UPDATE policy needed)

-- 5. RLS policies — seller_verification_reviews
-- Users can read reviews about themselves
CREATE POLICY "Users can view own verification reviews"
  ON public.seller_verification_reviews
  FOR SELECT
  USING (auth.uid() = user_id);

-- Service role handles inserts (admin actions only)

-- 6. updated_at trigger for seller_verification_documents
CREATE OR REPLACE FUNCTION public.update_seller_verification_documents_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER set_seller_verification_documents_updated_at
  BEFORE UPDATE ON public.seller_verification_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.update_seller_verification_documents_updated_at();

-- 7. Indexes
CREATE INDEX IF NOT EXISTS idx_seller_verification_documents_user_status
  ON public.seller_verification_documents(user_id, status);

CREATE INDEX IF NOT EXISTS idx_seller_verification_reviews_user
  ON public.seller_verification_reviews(user_id);
