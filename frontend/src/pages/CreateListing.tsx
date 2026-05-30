import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { ErrorHandler, AppError, ErrorCode } from '@/lib/errors/ErrorHandler';
import { api } from '@/lib/api';
import {
  isSellerVerified,
  type VerificationStatus,
} from '@/features/seller-verification/types/sellerVerification';

const MEDIA_BUCKET = 'auctionx-media-prod-cl';

export function CreateListing() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [verificationStatus, setVerificationStatus] = useState<VerificationStatus | null>(null);
  const [verificationLoading, setVerificationLoading] = useState(true);
  // rejectionReason no longer surfaced inline on this page — the dedicated
  // /seller/verification page shows the full rejection context.
  const [_rejectionReason, setRejectionReason] = useState<string | null>(null);
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [categoryId, setCategoryId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startingPrice, setStartingPrice] = useState('');
  const [reservePrice, setReservePrice] = useState('');
  const [duration, setDuration] = useState('7');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [addVerification, setAddVerification] = useState(false);
  const [saving, setSaving] = useState(false);

  // Check seller verification status
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('users')
          .select('seller_verification_status, seller_verification_rejection_reason, role')
          .eq('id', user.id)
          .single();
        if (cancelled) return;
        if (!error && data) {
          // Admins / super_admins bypass the verification gate
          const isAdmin = data.role === 'admin' || data.role === 'super_admin';
          setVerificationStatus(
            isAdmin ? 'VERIFIED' : ((data.seller_verification_status || 'NONE') as VerificationStatus),
          );
          setRejectionReason(data.seller_verification_rejection_reason);
        }
      } catch {
        // Fail-open: show the form
        if (!cancelled) setVerificationStatus('VERIFIED');
      } finally {
        if (!cancelled) setVerificationLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Fetch categories for the dropdown
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('categories')
        .select('id, name')
        .order('name', { ascending: true });
      if (cancelled) return;
      if (!error && data) {
        setCategories(data);
        if (data.length > 0) setCategoryId(data[0].id);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      ErrorHandler.handle(
        new AppError(
          ErrorCode.VALIDATION_FILE_TOO_LARGE,
          'File too large',
          { size: file.size, maxSize: 10485760 },
          'Photo must be less than 10MB',
        ),
        'CreateListing.handlePhotoChange',
      );
      return;
    }

    if (!file.type.startsWith('image/')) {
      ErrorHandler.handle(
        new AppError(
          ErrorCode.VALIDATION_INVALID_FILE_TYPE,
          'Invalid file type',
          { type: file.type },
          'Please select an image file',
        ),
        'CreateListing.handlePhotoChange',
      );
      return;
    }

    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  /**
   * Submit handler. `mode` controls whether we ship the listing as DRAFT or
   * ACTIVE. Per brief §6.1, only Publish is gated by verification — Save Draft
   * stays enabled so users can build a listing while their Yoti session is
   * still PENDING.
   */
  const handleSubmit = async (e: React.FormEvent, mode: 'publish' | 'draft' = 'publish') => {
    e.preventDefault();
    if (!user) {
      navigate('/login');
      return;
    }

    if (mode === 'publish' && !isSellerVerified(verificationStatus)) {
      // Defence in depth — the Publish button is disabled, but if anything
      // bypasses that (keyboard submit etc.) we still refuse.
      ErrorHandler.handle(
        new AppError(
          ErrorCode.RLS_VERIFICATION_REQUIRED,
          'Verification required to publish',
          { verificationStatus },
          'Verify your identity to publish this listing',
        ),
        'CreateListing.handleSubmit.publishGate',
      );
      return;
    }

    if (!categoryId) {
      ErrorHandler.handle(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Category required',
          {},
          'Please choose a category for this listing',
        ),
        'CreateListing.handleSubmit',
      );
      return;
    }

    const startingPriceCents = startingPrice ? Math.round(parseFloat(startingPrice) * 100) : 0;
    const reservePriceCents = reservePrice ? Math.round(parseFloat(reservePrice) * 100) : null;
    if (startingPriceCents <= 0) {
      ErrorHandler.handle(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Starting price required',
          {},
          'Starting price must be greater than $0.00',
        ),
        'CreateListing.handleSubmit',
      );
      return;
    }

    setSaving(true);

    try {
      // 1. Upload photo (if provided)
      let photoUrl: string | null = null;
      let s3Key: string | null = null;
      let photoSizeBytes = 0;
      if (photoFile) {
        const fileExt = photoFile.name.split('.').pop() || 'jpg';
        const fileName = `${user.id}-${Date.now()}.${fileExt}`;
        s3Key = `listings/${fileName}`;
        photoSizeBytes = photoFile.size;

        const { error: uploadError } = await supabase.storage
          .from(MEDIA_BUCKET)
          .upload(s3Key, photoFile);
        if (uploadError) throw uploadError;

        const { data: publicUrlData } = supabase.storage
          .from(MEDIA_BUCKET)
          .getPublicUrl(s3Key);
        photoUrl = publicUrlData.publicUrl;
      }

      // 2. Insert listing. Mode 'publish' → ACTIVE + published_at, mode 'draft' → DRAFT.
      const nowIso = new Date().toISOString();
      const { data: listing, error: listingError } = await supabase
        .from('listings')
        .insert({
          seller_id: user.id,
          title,
          description: description || null,
          brand: 'AUCTIONX',
          category_id: categoryId,
          condition: 'GOOD',
          reserve_price_cents: reservePriceCents,
          currency: 'USD',
          status: mode === 'publish' ? 'ACTIVE' : 'DRAFT',
          published_at: mode === 'publish' ? nowIso : null,
        })
        .select()
        .single();
      if (listingError) throw listingError;

      // 3. Insert the auction row — required for bidding (publish mode only).
      // Drafts skip this; we'll create the auction when the seller publishes
      // from the listing-detail page.
      if (mode === 'publish') {
        const durationDays = parseInt(duration, 10) || 7;
        const startTime = new Date();
        const endTime = new Date(startTime.getTime() + durationDays * 24 * 60 * 60 * 1000);
        const { error: auctionError } = await supabase
          .from('auctions')
          .insert({
            listing_id: listing.id,
            seller_id: user.id,
            currency: 'USD',
            start_time: startTime.toISOString(),
            end_time: endTime.toISOString(),
            starting_price_cents: startingPriceCents,
            current_price_cents: startingPriceCents,
            minimum_increment_cents: 50,
            reserve_price_cents: reservePriceCents,
            status: 'ACTIVE',
          });
        if (auctionError) {
          // Rollback listing if auction creation failed — keeps state consistent.
          await supabase.from('listings').delete().eq('id', listing.id);
          throw auctionError;
        }
      }

      // 4. Insert listing_media row (non-fatal if it fails — listing still works without)
      if (photoUrl && s3Key) {
        const { error: mediaError } = await supabase
          .from('listing_media')
          .insert({
            listing_id: listing.id,
            type: 'IMAGE',
            s3_bucket: MEDIA_BUCKET,
            s3_key: s3Key,
            url: photoUrl,
            size_bytes: photoSizeBytes,
            sort_order: 0,
          });
        if (mediaError) {
          // Listing + auction are live; surface but don't fail the flow
          ErrorHandler.handle(mediaError, 'CreateListing.insertMedia');
        }
      }

      // 5. Navigate to verification flow or listing detail
      if (addVerification && mode === 'publish') {
        const verif = await api.createVerification(listing.id);
        navigate(`/verify/create/${verif.id}`);
      } else if (mode === 'draft') {
        navigate('/my-listings');
      } else {
        navigate(`/listings/${listing.id}`);
      }
    } catch (error) {
      ErrorHandler.handle(error, 'CreateListing.handleSubmit');
    } finally {
      setSaving(false);
    }
  };

  // Loading guard. The unverified state is NOT a full-page block anymore —
  // per S22 §6.1 the form remains usable so sellers can build a listing while
  // their Yoti session is still PENDING. Only the Publish action is gated.
  if (verificationLoading) {
    return (
      <div className="min-h-screen bg-dark-800 flex items-center justify-center">
        <div className="text-gray-400">Loading…</div>
      </div>
    );
  }

  const canPublish = isSellerVerified(verificationStatus);
  const publishTooltip = canPublish ? undefined : 'Verify your identity to publish';

  return (
    <ErrorBoundary>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4
                   bg-primary-500 text-white px-4 py-2 rounded-lg z-50
                   focus:outline-none focus:ring-2 focus:ring-white"
      >
        Skip to main content
      </a>

      <div className="min-h-screen bg-dark-800 py-12 px-4">
        <main id="main-content" className="max-w-3xl mx-auto">
          <div className="glass rounded-2xl p-8">
            <h1 className="text-3xl font-bold text-white mb-2">Create New Listing</h1>
            <p className="text-gray-400 mb-8">
              Fill out the details below to create your auction listing.
            </p>

            {!canPublish && (
              <div className="mb-6 glass rounded-xl border border-yellow-500/20 p-4 text-sm text-gray-300">
                <p>
                  <span className="text-yellow-400 font-medium">Verification required to publish.</span>
                  {' '}You can build your listing and save it as a draft. Publishing requires identity
                  verification.{' '}
                  <Link
                    to="/seller/verification"
                    className="text-primary-400 hover:text-primary-300 underline"
                  >
                    Verify now →
                  </Link>
                </p>
              </div>
            )}

            <form onSubmit={(e) => handleSubmit(e, 'publish')} aria-label="Create listing form" className="space-y-8">
              <section aria-labelledby="photo-heading">
                <h2 id="photo-heading" className="text-xl font-semibold text-white mb-4">
                  Listing Photo
                </h2>

                {photoPreview ? (
                  <div className="relative">
                    <img
                      src={photoPreview}
                      alt="Listing preview"
                      className="w-full h-64 object-cover rounded-xl"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setPhotoFile(null);
                        setPhotoPreview(null);
                      }}
                      aria-label="Remove photo"
                      className="absolute top-2 right-2 glass rounded-lg w-[44px] h-[44px] flex items-center justify-center
                                 hover:bg-white/10 transition-colors
                                 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800"
                    >
                      <svg
                        className="w-6 h-6 text-white"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </div>
                ) : (
                  <label className="cursor-pointer block">
                    <span className="sr-only">Choose listing photo</span>
                    <div
                      className="glass rounded-xl p-12 text-center hover:bg-white/10 transition-colors
                                    focus-within:ring-2 focus-within:ring-primary-500 focus-within:ring-offset-2 focus-within:ring-offset-dark-800"
                    >
                      <svg
                        className="mx-auto h-12 w-12 text-gray-400"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 4v16m8-8H4"
                        />
                      </svg>
                      <p className="mt-2 text-gray-400">Click to upload photo</p>
                      <p className="mt-1 text-sm text-gray-400">PNG, JPG, GIF up to 10MB</p>
                    </div>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handlePhotoChange}
                      className="sr-only"
                      aria-label="Upload listing photo"
                    />
                  </label>
                )}
              </section>

              <section aria-labelledby="details-heading">
                <h2 id="details-heading" className="text-xl font-semibold text-white mb-4">
                  Listing Details
                </h2>

                <div className="space-y-4">
                  <Input
                    label="Title"
                    id="title"
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g., Signed Baseball Card"
                    helperText="Choose a clear, descriptive title"
                  />

                  <div>
                    <label htmlFor="category" className="block text-sm font-medium text-gray-300 mb-2">
                      Category
                    </label>
                    <select
                      id="category"
                      required
                      value={categoryId}
                      onChange={(e) => setCategoryId(e.target.value)}
                      className="w-full min-h-[44px] px-4 py-3 rounded-xl
                                bg-dark-600 text-white
                                border border-transparent
                                focus:outline-none focus:ring-2 focus:ring-primary-500
                                focus:ring-offset-2 focus:ring-offset-dark-800"
                    >
                      {categories.length === 0 && <option value="">Loading categories…</option>}
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="description"
                      className="block text-sm font-medium text-gray-300 mb-2"
                    >
                      Description
                    </label>
                    <textarea
                      id="description"
                      required
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      rows={6}
                      placeholder="Describe your item in detail..."
                      className="w-full min-h-[120px] px-4 py-3 rounded-xl
                                bg-dark-600 text-white placeholder:text-gray-400
                                border border-transparent
                                focus:outline-none focus:ring-2 focus:ring-primary-500
                                focus:ring-offset-2 focus:ring-offset-dark-800
                                resize-none"
                    />
                  </div>
                </div>
              </section>

              <section aria-labelledby="verification-heading">
                <h2 id="verification-heading" className="text-xl font-semibold text-white mb-4">
                  NFC Verification
                </h2>
                <div className="glass rounded-xl p-4 space-y-3">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={addVerification}
                      onChange={(e) => setAddVerification(e.target.checked)}
                      className="w-5 h-5 rounded accent-purple-500 cursor-pointer"
                    />
                    <span className="text-gray-200 text-sm font-medium">
                      Add NFC Verification (requires NFC tag + 15-second video)
                    </span>
                  </label>
                  {addVerification && (
                    <p className="text-sm text-gray-400 pl-8">
                      After creating the listing, you'll record a possession-proof video on your phone
                      and program your NTAG 424 DNA tag. Your token name will be assigned automatically.
                    </p>
                  )}
                </div>
              </section>

              <section aria-labelledby="pricing-heading">
                <h2 id="pricing-heading" className="text-xl font-semibold text-white mb-4">
                  Pricing & Duration
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Input
                    label="Starting Price"
                    id="starting-price"
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={startingPrice}
                    onChange={(e) => setStartingPrice(e.target.value)}
                    placeholder="0.00"
                    helperText="Minimum bid amount"
                  />

                  <Input
                    label="Reserve Price (Optional)"
                    id="reserve-price"
                    type="number"
                    step="0.01"
                    min="0"
                    value={reservePrice}
                    onChange={(e) => setReservePrice(e.target.value)}
                    placeholder="0.00"
                    helperText="Minimum sale price"
                  />

                  <div>
                    <label
                      htmlFor="duration"
                      className="block text-sm font-medium text-gray-300 mb-2"
                    >
                      Auction Duration
                    </label>
                    <select
                      id="duration"
                      value={duration}
                      onChange={(e) => setDuration(e.target.value)}
                      className="w-full min-h-[44px] px-4 py-3 rounded-xl
                                bg-dark-600 text-white
                                border border-transparent
                                focus:outline-none focus:ring-2 focus:ring-primary-500
                                focus:ring-offset-2 focus:ring-offset-dark-800"
                    >
                      <option value="1">1 day</option>
                      <option value="3">3 days</option>
                      <option value="7">7 days</option>
                      <option value="14">14 days</option>
                      <option value="30">30 days</option>
                    </select>
                  </div>
                </div>
              </section>

              <div className="flex flex-wrap gap-4">
                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  disabled={saving || !canPublish}
                  title={publishTooltip}
                  aria-label={canPublish ? 'Publish listing' : 'Publish disabled — verification required'}
                >
                  {saving ? 'Publishing…' : 'Publish'}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="lg"
                  disabled={saving}
                  onClick={(e) => handleSubmit(e as unknown as React.FormEvent, 'draft')}
                  aria-label="Save listing as draft"
                >
                  {saving ? 'Saving…' : 'Save Draft'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="lg"
                  onClick={() => navigate('/my-listings')}
                  disabled={saving}
                >
                  Cancel
                </Button>
              </div>
              {!canPublish && (
                <p className="text-xs text-gray-500 mt-2">
                  Publish is disabled until your identity is verified.
                </p>
              )}
            </form>
          </div>
        </main>
      </div>
    </ErrorBoundary>
  );
}
