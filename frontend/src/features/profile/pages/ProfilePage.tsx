import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { supabase } from '@/features/auth/lib/supabase';
import { ErrorHandler, AppError, ErrorCode } from '@/lib/errors/ErrorHandler';

interface Profile {
  id: string;
  display_name: string | null;
  photo_url: string | null;
}

export function ProfilePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    loadProfile();
  }, [user, navigate]);

  const loadProfile = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('users')
        .select('id, display_name, photo_url')
        .eq('id', user.id)
        .single();

      if (error) throw error;

      if (data) {
        setProfile(data);
        setDisplayName(data.display_name || '');
        setPhotoPreview(data.photo_url);
      }
    } catch (error) {
      ErrorHandler.handle(error, 'ProfilePage.loadProfile');
    } finally {
      setLoading(false);
    }
  };

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      ErrorHandler.handle(
        new AppError(
          ErrorCode.VALIDATION_FILE_TOO_LARGE,
          'File too large',
          { size: file.size, maxSize: 5242880 },
          'Photo must be less than 5MB'
        ),
        'ProfilePage.handlePhotoChange'
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
        'ProfilePage.handlePhotoChange'
      );
      return;
    }

    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setSaving(true);

    try {
      let photoUrl = profile?.photo_url ?? null;

      if (photoFile) {
        const fileExt = photoFile.name.split('.').pop();
        const fileName = `${user.id}-${Date.now()}.${fileExt}`;
        const filePath = `profile-photos/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from('auctionx-media-prod-cl')
          .upload(filePath, photoFile);

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
          .from('auctionx-media-prod-cl')
          .getPublicUrl(filePath);

        photoUrl = publicUrl;
      }

      const { error } = await supabase
        .from('users')
        .update({
          display_name: displayName || null,
          photo_url: photoUrl,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id);

      if (error) throw error;

      navigate('/my-listings');
    } catch (error) {
      ErrorHandler.handle(error, 'ProfilePage.handleSubmit');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-dark-800 flex items-center justify-center">
        <p className="text-gray-400">Loading profile...</p>
      </div>
    );
  }

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
        <main id="main-content" className="max-w-2xl mx-auto">
          <div className="glass rounded-2xl p-8">
            <h1 className="text-3xl font-bold text-white mb-2">
              Your Profile
            </h1>
            <p className="text-gray-400 mb-8">
              Complete your profile to start buying and selling.
            </p>

            <form onSubmit={handleSubmit} aria-label="Profile form" className="space-y-8">
              <section aria-labelledby="photo-heading">
                <h2 id="photo-heading" className="text-xl font-semibold text-white mb-4">
                  Profile Photo
                </h2>

                <div className="flex items-center gap-6">
                  {photoPreview ? (
                    <img
                      src={photoPreview}
                      alt="Profile preview"
                      className="w-24 h-24 rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-24 h-24 rounded-full bg-dark-600 flex items-center justify-center">
                      <span className="text-gray-500 text-sm">No photo</span>
                    </div>
                  )}

                  <label className="cursor-pointer">
                    <span className="sr-only">Choose profile photo</span>
                    <Button type="button" variant="secondary" size="md">
                      Choose Photo
                    </Button>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handlePhotoChange}
                      className="sr-only"
                      aria-label="Upload profile photo"
                    />
                  </label>
                </div>
              </section>

              <section aria-labelledby="info-heading">
                <h2 id="info-heading" className="text-xl font-semibold text-white mb-4">
                  Basic Information
                </h2>

                <div className="space-y-4">
                  <Input
                    label="Display Name"
                    id="display-name"
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="How should we address you?"
                    helperText="This will be visible to other users"
                  />

                  <div>
                    <label htmlFor="bio" className="block text-sm font-medium text-gray-300 mb-2">
                      Bio
                    </label>
                    <textarea
                      id="bio"
                      value={bio}
                      onChange={(e) => setBio(e.target.value)}
                      rows={4}
                      placeholder="Tell us about yourself..."
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

              <div className="flex gap-4">
                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  disabled={saving}
                  fullWidth
                >
                  {saving ? 'Saving...' : 'Save Profile'}
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  size="lg"
                  onClick={() => navigate('/my-listings')}
                  disabled={saving}
                >
                  Skip
                </Button>
              </div>
            </form>
          </div>
        </main>
      </div>
    </ErrorBoundary>
  );
}
