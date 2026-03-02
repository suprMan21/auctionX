import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { supabase } from '@/features/auth/lib/supabase';
import { ErrorHandler, AppError, ErrorCode } from '@/lib/errors/ErrorHandler';
import { api } from '@/lib/api';

export function CreateListing() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startingPrice, setStartingPrice] = useState('');
  const [reservePrice, setReservePrice] = useState('');
  const [duration, setDuration] = useState('7');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [addVerification, setAddVerification] = useState(false);

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      ErrorHandler.handle(
        new AppError(
          ErrorCode.VALIDATION_FILE_TOO_LARGE,
          'File too large',
          { size: file.size, maxSize: 10485760 },
          'Photo must be less than 10MB'
        ),
        'CreateListing.handlePhotoChange'
      );
      return;
    }

    if (!file.type.startsWith('image/')) {
      ErrorHandler.handle(
        new AppError(
          ErrorCode.VALIDATION_INVALID_FILE_TYPE,
          'Invalid file type',
          { type: file.type },
          'Please select an image file'
        ),
        'CreateListing.handlePhotoChange'
      );
      return;
    }

    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      navigate('/login');
      return;
    }

    setSaving(true);

    try {
      if (photoFile) {
        const fileExt = photoFile.name.split('.').pop();
        const fileName = `${user.id}-${Date.now()}.${fileExt}`;
        const filePath = `listings/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from('auctionx-media-prod-cl')
          .upload(filePath, photoFile);

        if (uploadError) throw uploadError;
        // Photo uploaded; linking to listing_media handled separately
      }

      const { data, error } = await supabase
        .from('listings')
        .insert({
          seller_id: user.id,
          title,
          description: description || null,
          brand: 'AUCTIONX' as const,
          category_id: '', // simplified form — category not collected here
          condition: 'GOOD' as const,
          reserve_price_cents: reservePrice ? Math.round(parseFloat(reservePrice) * 100) : null,
          status: 'DRAFT' as const,
        })
        .select()
        .single();

      if (error) throw error;

      if (addVerification) {
        const verif = await api.createVerification(data.id);
        navigate(`/verify/create/${verif.id}`);
      } else {
        navigate(`/listings/${data.id}`);
      }
    } catch (error) {
      ErrorHandler.handle(error, 'CreateListing.handleSubmit');
    } finally {
      setSaving(false);
    }
  };

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
            <h1 className="text-3xl font-bold text-white mb-2">
              Create New Listing
            </h1>
            <p className="text-gray-400 mb-8">
              Fill out the details below to create your auction listing.
            </p>

            <form onSubmit={handleSubmit} aria-label="Create listing form" className="space-y-8">
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
                      <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ) : (
                  <label className="cursor-pointer block">
                    <span className="sr-only">Choose listing photo</span>
                    <div className="glass rounded-xl p-12 text-center hover:bg-white/10 transition-colors
                                    focus-within:ring-2 focus-within:ring-primary-500 focus-within:ring-offset-2 focus-within:ring-offset-dark-800">
                      <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      <p className="mt-2 text-gray-400">Click to upload photo</p>
                      <p className="mt-1 text-sm text-gray-500">PNG, JPG, GIF up to 10MB</p>
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
                    <label htmlFor="description" className="block text-sm font-medium text-gray-300 mb-2">
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
                                bg-dark-600 text-white placeholder:text-gray-500
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
                    <label htmlFor="duration" className="block text-sm font-medium text-gray-300 mb-2">
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

              <div className="flex gap-4">
                <Button type="submit" variant="primary" size="lg" disabled={saving} fullWidth>
                  {saving ? 'Creating...' : 'Create Listing'}
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
            </form>
          </div>
        </main>
      </div>
    </ErrorBoundary>
  );
}
